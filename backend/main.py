"""
FastAPI Backend for City of Kingston 311 Chatbot
Using LangChain for RAG pipeline
"""

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, Response
from pydantic import BaseModel
from typing import List, Optional, Tuple, Iterable, Any, Set
import os
import re
import requests
from bs4 import BeautifulSoup
import time
import xml.etree.ElementTree as ET
from langchain_openai import ChatOpenAI
from langchain.prompts import PromptTemplate
from langchain.chains import LLMChain
from pinecone import Pinecone
from openai import OpenAI
import json
import asyncio

app = FastAPI(title="City of Kingston 311 Chatbot API")

# CORS middleware for React frontend
# In production, allow all origins (Vercel will provide the domain)
# In development, restrict to localhost
allowed_origins_env = os.getenv("ALLOWED_ORIGINS", "").strip()

# Default behavior: if empty or "*", allow all origins (for production)
# Note: When allow_credentials=True, we can't use ["*"], so we need to handle it differently
if not allowed_origins_env or allowed_origins_env == "*":
    # For wildcard, we'll allow credentials=False or handle it in the OPTIONS handler
    allowed_origins = ["*"]
    use_credentials = False  # Can't use credentials with wildcard
    print(f"[CORS] Allowing all origins (wildcard enabled, credentials disabled)")
else:
    # Parse comma-separated list
    allowed_origins = [origin.strip() for origin in allowed_origins_env.split(",") if origin.strip()]
    use_credentials = True
    print(f"[CORS] Allowed origins: {allowed_origins}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=use_credentials,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# Initialize OpenAI and Pinecone
pinecone_api_key = os.getenv("PINECONE_API_KEY")
openai_api_key = os.getenv("OPENAI_API_KEY")

if not pinecone_api_key or not openai_api_key:
    raise ValueError("PINECONE_API_KEY and OPENAI_API_KEY environment variables must be set")

# Initialize Pinecone and OpenAI clients
pc_client = Pinecone(api_key=pinecone_api_key)
index = pc_client.Index("kingston-policies")
openai_client = OpenAI(api_key=openai_api_key)

# -------------------------
# Retrieval helpers (RAG)
# -------------------------
def _normalize_category(value: str) -> str:
    """
    Normalize categories so metadata like 'Property Tax', 'property-tax', 'property_tax'
    all compare equal.
    """
    if not value:
        return ""
    normalized = re.sub(r"[^a-z0-9]+", "_", value.strip().lower())
    return normalized.strip("_")


def _clean_retrieved_content(raw: str) -> str:
    """
    Clean common navigation / boilerplate fragments from scraped content.
    We prefer cleaning over dropping entire docs, otherwise RAG can end up with
    empty context (especially pages containing 'Section Menu').
    """
    if not raw:
        return ""
    text = raw

    # Remove common nav labels / boilerplate tokens
    text = re.sub(r"\bSection Menu\b", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"\bContact Us\b", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"\bCity of Kingston\b", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"\bCity Hall\b", " ", text, flags=re.IGNORECASE)

    # Remove cheque / mailing-address sections if present in scraped text
    text = re.sub(
        r"Make your cheque payable to City of Kingston and mail it to.*?(?=\n\n|\Z)",
        " ",
        text,
        flags=re.DOTALL | re.IGNORECASE,
    )
    text = re.sub(
        r"Make your cheque payable.*?PO Box 640.*?(?=\n\n|\Z)",
        " ",
        text,
        flags=re.DOTALL | re.IGNORECASE,
    )

    # Collapse whitespace
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _select_context_and_results(
    matches: Iterable[Any],
    expected_category: str,
    top_k: int,
) -> tuple[list[dict], list[str]]:
    """
    Turn Pinecone matches into:
    - formatted_results (for UI sources)
    - context_parts (for LLM prompt)

    Key behaviors:
    - Category matching is normalized.
    - Dedup by source_url so repeated near-duplicates don't crowd out better docs.
    - Clean common boilerplate rather than dropping entire docs.
    - If category-filtered candidates yield no usable context, fall back to all matches.
    """
    expected_norm = _normalize_category(expected_category)

    def to_item(m: Any) -> dict:
        md = getattr(m, "metadata", {}) or {}
        return {
            "score": getattr(m, "score", 0.0),
            "raw_content": md.get("content", "") or "",
            "category": md.get("category", "") or "",
            "topic": md.get("topic", "") or "",
            "source_url": md.get("source_url", "") or "",
        }

    items = [to_item(m) for m in (matches or [])]
    items.sort(key=lambda x: -(x.get("score") or 0.0))

    def build_from(candidate_items: list[dict]) -> tuple[list[dict], list[str]]:
        formatted: list[dict] = []
        context: list[str] = []
        seen_urls: Set[str] = set()

        # Consider more than top_k*2 because top results can be boilerplate-heavy
        candidate_limit = max(top_k * 6, 20)

        for item in candidate_items[:candidate_limit]:
            url = item.get("source_url", "")
            if url and url in seen_urls:
                continue

            cleaned = _clean_retrieved_content(item.get("raw_content", ""))

            # Skip tiny / empty chunks after cleaning
            if len(cleaned) < 200:
                continue

            if url:
                seen_urls.add(url)

            formatted.append(
                {
                    "score": item.get("score", 0.0),
                    "content": cleaned[:500],
                    "category": item.get("category", ""),
                    "topic": item.get("topic", ""),
                    "source_url": url,
                }
            )
            context.append(cleaned[:2000])

            if len(context) >= top_k:
                break

        return formatted, context

    # First try: only expected category (normalized)
    if expected_norm:
        filtered = [
            it for it in items if _normalize_category(it.get("category", "")) == expected_norm
        ]
    else:
        filtered = items

    formatted_results, context_parts = build_from(filtered)

    # Fallback: if filtering produced no usable context, try unfiltered
    if not context_parts:
        formatted_results, context_parts = build_from(items)

    return formatted_results, context_parts


# -------------------------
# Dynamic (official-site) search helpers
# -------------------------
ALLOWED_DYNAMIC_DOMAINS: Set[str] = {
    "cityofkingston.ca",
    "www.cityofkingston.ca",
    "mycity.cityofkingston.ca",
    # Kingston Transit runs on a separate official domain
    "kingstontransit.ca",
    "www.kingstontransit.ca",
}

CURATED_DYNAMIC_SOURCES: dict = {
    # Transportation/operations pages that can change frequently
    "road_closures": [
        {
            "title": "Traffic and Road Closures",
            "url": "https://www.cityofkingston.ca/roads-parking-and-transportation/road-maintenance/road-closures/",
        },
        {
            "title": "Road Closures Map",
            "url": "https://www.cityofkingston.ca/roads-parking-and-transportation/road-maintenance/road-closures/road-closures-map/",
        }
    ],
    "snow_removal": [
        {
            "title": "Winter Maintenance",
            "url": "https://www.cityofkingston.ca/roads-parking-and-transportation/winter-maintenance/",
        },
        {
            "title": "Snow Plow Tracker",
            "url": "https://www.cityofkingston.ca/roads-parking-and-transportation/winter-maintenance/snow-plow-tracker/",
        },
        {
            "title": "Winter Parking",
            "url": "https://www.cityofkingston.ca/roads-parking-and-transportation/parking/winter-parking/",
        }
    ],
    "transit": [
        {
            "title": "Transit News and Notices",
            "url": "https://www.cityofkingston.ca/news-and-notices/transit-news/",
        }
    ],
    "transit_lost_found": [
        {
            "title": "Kingston Transit – Lost and Found",
            "url": "https://www.kingstontransit.ca/lost-and-found/",
        }
    ],
    # Optional: weather/safety page placeholder (kept empty unless you add an official Kingston source)
    "weather": [],
}

_SITEMAP_CACHE: dict = {"ts": 0.0, "items": []}  # {ts: float, items: list[dict]}
SITEMAP_TTL_SECONDS = int(os.getenv("SITEMAP_TTL_SECONDS", "3600"))
SITEMAP_URL = os.getenv("SITEMAP_URL", "https://www.cityofkingston.ca/sitemap.xml")


def _is_allowed_domain(url: str) -> bool:
    try:
        from urllib.parse import urlparse

        host = (urlparse(url).hostname or "").lower()
        return host in ALLOWED_DYNAMIC_DOMAINS
    except Exception:
        return False


def classify_dynamic_bucket(query: str) -> Optional[str]:
    """
    Prototype-only routing: dynamic = fast-changing operational info.
    Returns a bucket key or None.
    """
    q = (query or "").lower()

    # Time-sensitive hint + road-ish wording should still be treated as dynamic
    time_hint = any(k in q for k in ["today", "tomorrow", "now", "right now", "current", "latest", "updated"])

    # Common road closures phrasing + typos seen in real user input
    road_terms = [
        "road closure",
        "road closures",
        "road closed",
        "lane closed",
        "closure",
        "traffic",
        "detour",
        "construction",
        "road work",
        "roadwork",
        "blocked",
        "road blocked",
        "blockage",
    ]

    # Catch frequent misspellings like "contruction" / "constuction"
    construction_typos = any(k in q for k in ["contruc", "constuc", "construc"])

    if any(k in q for k in road_terms) or (time_hint and "road" in q) or construction_typos:
        return "road_closures"

    if any(k in q for k in ["snow", "snow removal", "plow", "plowing", "winter maintenance", "winter"]):
        return "snow_removal"

    # Transit lost & found (common real-world question; official site is kingstontransit.ca)
    if any(k in q for k in ["lost and found", "lost my", "lost wallet", "lost phone", "lost item"]) and any(
        k in q for k in ["transit", "bus", "kingston transit"]
    ):
        return "transit_lost_found"

    if any(k in q for k in ["transit", "bus", "kingston transit", "route", "detour", "delay", "delayed", "cancelled", "canceled"]):
        return "transit"

    if "weather" in q:
        return "weather"

    return None


def is_dynamic_query(query: str) -> bool:
    """
    Dynamic = fast-changing operational info (transit/closures/snow/weather).
    Keep this simple for the prototype.
    """
    return classify_dynamic_bucket(query) is not None


def _http_get(url: str) -> str:
    headers = {
        "User-Agent": "CityOfKingston311Bot/1.0 (+https://www.cityofkingston.ca/)",
        "Accept": "text/html,application/xhtml+xml",
    }
    resp = requests.get(url, headers=headers, timeout=15)
    resp.raise_for_status()
    return resp.text


def extract_page_text(html: str) -> str:
    """
    Extract readable text from an HTML page and aggressively remove nav/boilerplate.
    """
    if not html:
        return ""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    text = soup.get_text("\n", strip=True)
    return _clean_retrieved_content(text)


def _fetch_sitemap_items() -> list[dict]:
    """
    Fetch the City's sitemap and return:
    [{"loc": str, "lastmod": str|None}]
    Cached in-memory for TTL seconds.
    """
    now = time.time()
    if _SITEMAP_CACHE["items"] and (now - float(_SITEMAP_CACHE["ts"])) < SITEMAP_TTL_SECONDS:
        return _SITEMAP_CACHE["items"]

    try:
        xml_text = _http_get(SITEMAP_URL)
        root = ET.fromstring(xml_text)
        ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        items: list[dict] = []
        for url_el in root.findall("sm:url", ns):
            loc_el = url_el.find("sm:loc", ns)
            lastmod_el = url_el.find("sm:lastmod", ns)
            loc = (loc_el.text or "").strip() if loc_el is not None else ""
            if not loc:
                continue
            if not _is_allowed_domain(loc):
                continue
            items.append(
                {
                    "loc": loc,
                    "lastmod": (lastmod_el.text or "").strip() if lastmod_el is not None else None,
                }
            )
        _SITEMAP_CACHE["ts"] = now
        _SITEMAP_CACHE["items"] = items
        return items
    except Exception as e:
        print(f"[SITEMAP] Failed to fetch/parse sitemap: {e}")
        return []


def _pick_latest(items: list[dict], url_substring: str, limit: int = 3) -> list[str]:
    """
    Pick latest URLs matching substring, ordered by lastmod desc when available.
    """
    matches = [it for it in items if url_substring in (it.get("loc") or "")]

    def key(it: dict) -> str:
        return it.get("lastmod") or ""

    matches.sort(key=key, reverse=True)
    urls: list[str] = []
    for it in matches:
        loc = it.get("loc") or ""
        if loc and loc not in urls:
            urls.append(loc)
        if len(urls) >= limit:
            break
    return urls


def select_dynamic_sources(bucket: Optional[str], query: str, max_results: int = 6) -> list[dict]:
    """
    Combine curated seed pages + most recent relevant pages from the City's sitemap.
    Only returns URLs from allowed domains.
    """
    bucket = bucket or classify_dynamic_bucket(query)
    base = list(CURATED_DYNAMIC_SOURCES.get(bucket, []) if bucket else [])

    items = _fetch_sitemap_items()
    extra_urls: list[str] = []

    if bucket == "road_closures":
        extra_urls.extend(_pick_latest(items, "/news/posts/weekly-traffic-report-", limit=3))
        extra_urls.extend(_pick_latest(items, "/news/posts/traffic-report", limit=2))

    elif bucket == "transit":
        extra_urls.extend(_pick_latest(items, "/news/posts/kingston-transit-service-alert", limit=4))
        extra_urls.extend(_pick_latest(items, "/news-and-notices/transit-news/", limit=1))

    elif bucket == "snow_removal":
        extra_urls.extend(_pick_latest(items, "/news/posts/winter-parking", limit=4))
        extra_urls.extend(_pick_latest(items, "/news/posts/winter-services-response-plan", limit=2))

    elif bucket == "transit_lost_found":
        # Curated page on kingstontransit.ca is the primary source; no sitemap expansion needed.
        pass

    elif bucket == "weather":
        pass

    seen: Set[str] = set()
    out: list[dict] = []

    def add(title: str, url: str) -> None:
        if not url or url in seen:
            return
        if not _is_allowed_domain(url):
            return
        seen.add(url)
        out.append({"title": title, "url": url})

    for s in base:
        add(s.get("title", ""), s.get("url", ""))

    for url in extra_urls:
        add("Official update", url)

    return out[:max_results]


def build_dynamic_context(query: str, max_results: int = 4) -> tuple[list[dict], str]:
    """
    Returns (sources, context_text).
    context_text is formatted with per-source blocks so the model can cite them.
    """
    bucket = classify_dynamic_bucket(query)
    sources = select_dynamic_sources(bucket, query, max_results=max_results)
    if not sources:
        return [], ""

    context_blocks: list[str] = []
    usable_sources: list[dict] = []

    for idx, src in enumerate(sources, start=1):
        url = src.get("url", "")
        if not url:
            continue
        if not _is_allowed_domain(url):
            continue
        try:
            html = _http_get(url)
            page_text = extract_page_text(html)
            if len(page_text) < 300:
                continue
            snippet = page_text[:3500]
            title = (src.get("title") or "").strip()
            if title.lower() == "official update":
                # Try to improve placeholder titles from the HTML <title>
                try:
                    soup = BeautifulSoup(html, "html.parser")
                    html_title = (soup.title.get_text(" ", strip=True) if soup.title else "").strip()
                    if html_title:
                        title = html_title[:120]
                        src["title"] = title
                except Exception:
                    pass

            header = f"[{idx}] {title or 'Official source'}\nURL: {url}\n"
            context_blocks.append(f"{header}\n{snippet}")
            usable_sources.append(src)
        except Exception as e:
            print(f"[DYNAMIC SEARCH] Failed to fetch {url}: {e}")
            continue

        if len(usable_sources) >= max_results:
            break

    return usable_sources, "\n\n".join(context_blocks).strip()

# Initialize LangChain LLM for answer generation
llm = ChatOpenAI(
    model="gpt-4o-mini",
    temperature=0.2,
    openai_api_key=openai_api_key,
    max_tokens=800,  # Allow comprehensive answers
    streaming=True  # Enable streaming
)

# Create custom prompt template - Simple RAG: provide complete information from database
def get_prompt_template(category: str) -> str:
    """Get prompt template - Simple RAG that provides complete information"""
    
    # Only add collection calendar info for waste_collection questions
    if category == "waste_collection":
        schedule_instruction = """
For schedule/collection questions ("when", "what day", "pickup", "collection day"):
- START with: "[Collection type] occurs on designated days as per the waste collection calendar."
- THEN add: All relevant schedule facts from context
- END WITH: "To find your specific collection day, enter your address at https://www.cityofkingston.ca/garbage-and-recycling/collection-calendar/"
"""
    else:
        schedule_instruction = ""
    
    return f"""You are a helpful assistant for the City of Kingston 311 service. Answer the user's question using ONLY the information provided in the context below.

CRITICAL RULES:
1. You MUST use information from the context provided - do not say "context is missing" or "I don't have context"
2. Provide complete, detailed answers from the context
3. Use simple, clear language
4. Include all relevant details: steps, requirements, deadlines, fees, etc.
5. If forms/applications are mentioned in context, explain the process
6. Answer ONLY about {category.replace('_', ' ')} - do not mention unrelated topics
7. If the context doesn't contain the answer, say: "I don't have that specific information. Please contact 311 at 613-546-0000."
8. DO NOT include mailing address information (PO Box 640, Kingston, ON K7L 4X1) or instructions about making cheques payable - omit this information completely

{schedule_instruction}

Context from City of Kingston ({category}):
{{context}}

Question: {{question}}

Answer (use the context above to provide a complete answer):"""

# Create LLM chain factory - creates chain with category-specific prompt
def create_llm_chain(category: str):
    """Create LLM chain with category-specific prompt"""
    template = get_prompt_template(category)
    prompt = PromptTemplate(
        template=template,
        input_variables=["context", "question"]
    )
    return prompt | llm


def extract_address(query: str) -> Optional[str]:
    """Extract address from query if present"""
    # Look for patterns like "my address is X" or "address: X" or just an address
    patterns = [
        r"my address is (.+)",
        r"address is (.+)",
        r"address: (.+)",
        r"at (.+?)(?:\.|$)",
    ]
    
    query_lower = query.lower()
    for pattern in patterns:
        match = re.search(pattern, query_lower, re.IGNORECASE)
        if match:
            address = match.group(1).strip()
            # Remove trailing punctuation
            address = re.sub(r'[.,;!?]+$', '', address)
            if len(address) > 5:  # Basic validation
                return address
    return None

def classify_question_intent_ai(query: str) -> Tuple[str, str]:
    """
    AGENT 1: Use AI to understand and classify the question.
    This prevents misclassification of unrelated questions.
    Returns: (intent_type, category)
    """
    try:
        classification_prompt = f"""Analyze this question and classify it into ONE category. Be very careful - only classify if it's clearly about City of Kingston services.

Question: "{query}"

Categories:
- live_status_lookup + waste_collection: Questions about WHEN garbage/recycling is collected, collection schedules, "what day is my pickup"
- policy_explanatory + parking: Questions about parking permits, parking rules, residential parking
- policy_explanatory + property_tax: Questions about property taxes, tax payments, tax bills
- policy_explanatory + waste_collection: Questions about WHAT goes in bins, recycling rules, garbage rules, blue box, green bin
- policy_explanatory + hazardous_waste: Questions about disposing hazardous materials, KARC, batteries
- policy_explanatory + fire_permits: Questions about fire permits, open air fires, burning
- policy_explanatory + noise: Questions about noise complaints, quiet hours, noise bylaws
- out_of_scope: Questions NOT about City of Kingston services (lost items, transit issues, general questions, etc.)

Respond with ONLY the category in format: intent_type|category
Example: "policy_explanatory|parking" or "out_of_scope|none"

If the question is clearly NOT about City of Kingston services, respond with "out_of_scope|none"
"""
        
        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a classification system. Respond with ONLY the category in format: intent_type|category"},
                {"role": "user", "content": classification_prompt}
            ],
            temperature=0.1,
            max_tokens=50
        )
        
        result = response.choices[0].message.content.strip().lower()
        print(f"[AGENT 1] Classification result: {result}")
        
        if "|" in result:
            intent_type, category = result.split("|")
            intent_type = intent_type.strip()
            category = category.strip()
            
            if intent_type == "out_of_scope" or category == "none":
                return ("out_of_scope", "none")
            
            return (intent_type, category)
        
        # Fallback to old method if AI fails
        return classify_question_intent_fallback(query)
        
    except Exception as e:
        print(f"[AGENT 1] Error in AI classification: {e}")
        return classify_question_intent_fallback(query)

def classify_question_intent_fallback(query: str) -> Tuple[str, str]:
    """
    Fallback classification using keyword matching (less accurate but reliable)
    """
    query_lower = query.lower()
    
    # Live lookup indicators (schedule questions) - be more specific
    live_keywords = [
        "when is my", "when does my", "what day is my", 
        "my collection day", "my pickup day",
        "check my collection", "find my collection"
    ]
    
    # Address patterns - be more strict
    address_patterns = [
        r"\d+\s+\w+\s+(street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|way|court|ct)",
    ]
    
    # Check for live lookup - must have both address pattern AND collection keywords
    has_address = any(re.search(pattern, query_lower) for pattern in address_patterns)
    has_collection_keyword = any(keyword in query_lower for keyword in live_keywords) or ("collection" in query_lower and "day" in query_lower)
    
    if has_address and has_collection_keyword:
        return ("live_status_lookup", "waste_collection")
    
    # Policy question - classify into specific category
    if any(term in query_lower for term in ["parking permit", "parking", "permit", "monthly parking", "residential parking"]):
        return ("policy_explanatory", "parking")
    
    if any(term in query_lower for term in ["property tax", "tax payment", "tax due", "tax bill", "pay taxes"]):
        return ("policy_explanatory", "property_tax")
    
    if any(term in query_lower for term in ["blue box", "grey box", "green bin", "what goes", "recycling", "garbage", "waste", "cart", "collection rules"]):
        return ("policy_explanatory", "waste_collection")
    
    if any(term in query_lower for term in ["hazardous waste", "karc", "dispose", "batteries", "drop off"]):
        return ("policy_explanatory", "hazardous_waste")
    
    if any(term in query_lower for term in ["fire permit", "open air fire", "burn", "fire pit"]):
        return ("policy_explanatory", "fire_permits")
    
    if any(term in query_lower for term in ["noise", "quiet hours", "bylaw", "nuisance", "complaint"]):
        return ("policy_explanatory", "noise")
    
    # Default - but this should rarely happen with AI classification
    return ("policy_explanatory", "waste_collection")

def classify_question_intent(query: str) -> Tuple[str, str]:
    """Main classification function - uses AI first, falls back to keyword matching"""
    return classify_question_intent_ai(query)

def is_greeting_or_simple_query(query: str) -> bool:
    """Detect if query is a greeting or simple interaction that doesn't need additional information"""
    query_lower = query.lower().strip()
    
    # Only detect EXACT greetings - be very strict
    exact_greetings = [
        "hi", "hello", "hey", 
        "good morning", "good afternoon", "good evening",
        "how are you", "what can you do", "what do you do",
        "what is this", "who are you", "introduce yourself"
    ]
    
    # Simple acknowledgment patterns (only if they're the whole query)
    simple_patterns = [
        "thanks", "thank you", "ok", "okay", "got it", "understood",
        "that's helpful", "that helps"
    ]
    
    # Check if it's EXACTLY a greeting (starts with or equals)
    if any(query_lower == pattern or query_lower.startswith(pattern + " ") or query_lower.startswith(pattern + "?") or query_lower.startswith(pattern + "!") for pattern in exact_greetings):
        # But exclude if it's a question about something (e.g., "help with parking" is NOT a greeting)
        if any(word in query_lower for word in ["with", "about", "for", "when", "where", "how", "what", "why", "can i", "do i", "should i"]):
            # This is a question, not a greeting
            return False
        return True
    
    # Check for simple acknowledgments (only if it's the whole query or very short)
    if len(query_lower.split()) <= 4:
        if any(query_lower == pattern or query_lower.startswith(pattern) for pattern in simple_patterns):
            return True
    
    return False

def translate_text(text: str, target_language: str, source_language: str = "auto") -> str:
    """
    Translate text using OpenAI.
    target_language: "en" or "fr"
    """
    if target_language == "en" and source_language == "en":
        return text  # No translation needed
    
    try:
        # Map language codes to full names for better results
        lang_map = {
            "en": "English",
            "fr": "French"
        }
        
        target_lang_name = lang_map.get(target_language, "English")
        source_lang_name = lang_map.get(source_language, "auto")
        
        if source_language == "auto":
            prompt = f"Translate the following text to {target_lang_name}. Only return the translation, nothing else:\n\n{text}"
        else:
            prompt = f"Translate the following text from {source_lang_name} to {target_lang_name}. Only return the translation, nothing else:\n\n{text}"
        
        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": f"You are a professional translator. Translate accurately and naturally to {target_lang_name}."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.2,
            max_tokens=1000
        )
        
        translated = response.choices[0].message.content.strip()
        print(f"[TRANSLATE] {source_language} -> {target_language}: {text[:50]}... -> {translated[:50]}...")
        return translated
        
    except Exception as e:
        print(f"[TRANSLATE] Error translating: {e}")
        return text  # Return original on error

def detect_language(text: str) -> str:
    """
    Detect language of text. Returns "en" or "fr"
    """
    try:
        # Quick keyword-based detection (faster than AI)
        text_lower = text.lower()
        french_indicators = ["le", "la", "les", "de", "du", "des", "et", "est", "pour", "avec", "dans", "sur", "par", "que", "qui", "quoi", "comment", "où", "quand", "pourquoi"]
        french_count = sum(1 for word in french_indicators if word in text_lower)
        
        if french_count >= 2:
            return "fr"
        
        # Use AI for more accurate detection if needed
        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a language detector. Respond with ONLY 'en' or 'fr'."},
                {"role": "user", "content": f"What language is this text? Respond with ONLY 'en' or 'fr':\n\n{text[:200]}"}
            ],
            temperature=0.1,
            max_tokens=10
        )
        
        detected = response.choices[0].message.content.strip().lower()
        if detected in ["en", "fr"]:
            return detected
        
        return "en"  # Default to English
        
    except Exception as e:
        print(f"[DETECT] Error detecting language: {e}")
        return "en"  # Default to English

def check_context_relevance(question: str, context_sample: str, expected_category: str) -> bool:
    """
    Quick check if context is relevant before generating answer.
    Returns True if context seems relevant, False otherwise.
    """
    try:
        # Quick keyword check first (faster)
        question_lower = question.lower()
        context_lower = context_sample.lower()
        
        # Extract key terms from question
        key_terms = []
        for word in question_lower.split():
            if len(word) > 3 and word not in ["what", "when", "where", "how", "why", "can", "the", "and", "for", "with", "about"]:
                key_terms.append(word)
        
        # Check if any key terms appear in context
        if key_terms:
            matches = sum(1 for term in key_terms if term in context_lower)
            if matches == 0 and len(key_terms) > 2:
                print(f"[QUICK CHECK] No key terms found in context")
                return False
        
        # If category is out_of_scope, context won't help
        if expected_category == "none" or "out_of_scope" in expected_category:
            return False
        
        return True
        
    except Exception as e:
        print(f"[QUICK CHECK] Error: {e}")
        # If check fails, assume context is relevant (let full validation handle it)
        return True

def validate_answer_relevance(question: str, answer: str, expected_category: str) -> dict:
    """
    AGENT 3: Validate that the answer actually answers the question.
    Returns: {"is_relevant": bool, "confidence": float, "reason": str}
    """
    try:
        validation_prompt = f"""You are a validation system. Check if the answer actually answers the question.

Question: "{question}"
Expected Category: {expected_category}
Answer: "{answer}"

Check:
1. Does the answer address the question asked?
2. Is the answer about the expected category ({expected_category})?
3. Does the answer make sense for the question?

Respond with ONLY: YES or NO
If NO, also provide a brief reason (one sentence).

Format: YES/NO|reason (if NO)
"""
        
        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a validation system. Respond with YES or NO, optionally followed by |reason"},
                {"role": "user", "content": validation_prompt}
            ],
            temperature=0.1,
            max_tokens=100
        )
        
        result = response.choices[0].message.content.strip().upper()
        print(f"[AGENT 3] Validation response: {result}")
        
        if result.startswith("YES"):
            return {"is_relevant": True, "confidence": 0.9, "reason": "Answer is relevant"}
        else:
            reason = result.split("|", 1)[1].strip() if "|" in result else "Answer doesn't match question"
            return {"is_relevant": False, "confidence": 0.8, "reason": reason}
            
    except Exception as e:
        print(f"[AGENT 3] Error in validation: {e}")
        # If validation fails, be conservative - assume answer is relevant
        return {"is_relevant": True, "confidence": 0.5, "reason": "Validation error, assuming relevant"}

def extract_address_clean(query: str) -> Optional[str]:
    """Extract and clean address from query"""
    # Remove common phrases
    query_clean = query.lower()
    query_clean = re.sub(r"(check for|look up|find|my address is|address is|address:)", "", query_clean)
    query_clean = query_clean.strip()
    
    # Look for address patterns - improved to catch "division st" and similar
    address_patterns = [
        r"(\d+\s+[\w\s]+(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|way|court|ct))",
        r"(\d+\s+division(?:\s+st(?:reet)?)?)",
        r"(\d+\s+[\w]+(?:\s+division)?)",
    ]
    
    for pattern in address_patterns:
        match = re.search(pattern, query_clean, re.IGNORECASE)
        if match:
            address = match.group(1).strip()
            # Clean up
            address = re.sub(r'[.,;!?]+$', '', address)
            if len(address) > 5:
                return address
    
    # Fallback: if it looks like an address (has numbers and words)
    if re.search(r'\d+', query_clean) and len(query_clean.split()) >= 2:
        # Remove trailing words like "check for this"
        words = query_clean.split()
        if len(words) >= 2:
            # Take first 2-4 words that look like address
            address_parts = []
            for word in words[:4]:
                if word not in ["check", "for", "this", "my", "address", "is", "the", "a", "an"]:
                    address_parts.append(word)
            if len(address_parts) >= 2:
                return " ".join(address_parts).strip()
    
    return None


class QueryRequest(BaseModel):
    query: str
    top_k: Optional[int] = 5
    session_id: Optional[str] = None  # For tracking conversation state
    language: Optional[str] = "en"  # Language preference: "en" or "fr"


class QueryResponse(BaseModel):
    answer: str
    results: List[dict]
    query: str
    intent: Optional[str] = None  # policy_explanatory or live_status_lookup
    requires_address: Optional[bool] = False
    workflow_state: Optional[str] = None  # WAITING_FOR_ADDRESS, ADDRESS_RECEIVED, etc.


class HealthResponse(BaseModel):
    status: str
    message: str


@app.get("/", response_model=HealthResponse)
async def root():
    """Health check endpoint"""
    return {"status": "ok", "message": "City of Kingston 311 Chatbot API is running"}


@app.options("/query/stream")
async def options_query_stream(request: Request):
    """Handle CORS preflight for streaming endpoint"""
    # Get origin from request
    origin = request.headers.get("origin", "*")
    
    # If wildcard is allowed, use the request origin
    if allowed_origins == ["*"]:
        return Response(
            status_code=200,
            headers={
                "Access-Control-Allow-Origin": origin,
                "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                "Access-Control-Allow-Headers": "*",
                "Access-Control-Max-Age": "3600",
            }
        )
    # Otherwise check if origin is allowed
    elif origin in allowed_origins:
        return Response(
            status_code=200,
            headers={
                "Access-Control-Allow-Origin": origin,
                "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                "Access-Control-Allow-Headers": "*",
                "Access-Control-Allow-Credentials": "true",
                "Access-Control-Max-Age": "3600",
            }
        )
    else:
        return Response(status_code=403)

@app.post("/query/stream")
async def query_pinecone_stream(request: QueryRequest):
    """Streaming endpoint for real-time response generation"""
    async def generate():
        try:
            import traceback
            print(f"[STREAM] Received query: {request.query}")
            print(f"[STREAM] Language preference: {request.language}")
            
            # Detect or use provided language
            detected_lang = detect_language(request.query) if request.language == "auto" else request.language
            user_language = detected_lang if request.language == "auto" else request.language
            
            # Translate query to English for processing (RAG is in English)
            original_query = request.query
            if user_language == "fr":
                print(f"[STREAM] Translating French query to English...")
                request.query = translate_text(request.query, "en", "fr")
                print(f"[STREAM] Translated query: {request.query}")
            
            # Decide dynamic vs static (using English query)
            dynamic = is_dynamic_query(request.query)
            print(f"[ROUTER] dynamic={dynamic}")

            # Classify intent/category for STATIC RAG (still useful for filtering)
            intent_type, category = classify_question_intent(request.query)
            user_address = extract_address_clean(request.query)
            print(f"[STREAM] Intent: {intent_type}, Category: {category}")
            
            # Handle greetings (with logging)
            is_greeting = is_greeting_or_simple_query(request.query)
            print(f"[STREAM] Is greeting: {is_greeting}")
            if is_greeting:
                greeting_en = "Hello! I'm the City of Kingston 311 assistant. How can I help you today?"
                greeting = translate_text(greeting_en, user_language, "en") if user_language == "fr" else greeting_en
                print(f"[STREAM] Returning greeting response")
                yield f"data: {json.dumps({'type': 'text', 'content': greeting, 'done': True})}\n\n"
                return
            
            # Dynamic route: official-site search first (citations required)
            if dynamic:
                print("[DYNAMIC] Building official-site context (sitemap + fetch)...")
                sources, dyn_context = build_dynamic_context(request.query, max_results=6)
                if not sources:
                    print("[DYNAMIC] No official sources found")
                    fallback_msg_en = "I couldn't find an official City of Kingston page for that. Please try rephrasing, or contact 311 at 613-546-0000 for assistance."
                    fallback_msg = translate_text(fallback_msg_en, user_language, "en") if user_language == "fr" else fallback_msg_en
                    yield f"data: {json.dumps({'type': 'text', 'content': fallback_msg, 'done': True})}\n\n"
                    return

                if not dyn_context:
                    # If pages are JS-heavy and we can't extract text, at least provide links.
                    lines_en = [
                        "For the latest updates, please check these official City of Kingston pages:",
                    ]
                    for i, s in enumerate(sources, start=1):
                        title = s.get("title") or f"Source {i}"
                        url = s.get("url") or ""
                        if url:
                            lines_en.append(f"{i}. {title} [{i}]")
                    lines_en.append("If you still can’t find what you need there, contact 311 at 613-546-0000.")
                    msg_en = "\n".join(lines_en).strip()
                    msg = translate_text(msg_en, user_language, "en") if user_language == "fr" else msg_en
                    yield f"data: {json.dumps({'type': 'text', 'content': msg})}\n\n"
                else:
                    dyn_prompt = f"""You are the City of Kingston 311 assistant.
Answer the user's question using ONLY the official sources provided below.

Rules:
1) If the sources do not contain the answer, say: "I couldn't confirm that on official City of Kingston sources."
2) Do NOT guess. Do NOT use outside knowledge.
3) Include citations like [1], [2] matching the source numbers.
4) Keep the answer clear and practical.

Question: {request.query}

Official sources:
{dyn_context}
"""

                    print("[DYNAMIC] Starting OpenAI stream...")
                    stream = openai_client.chat.completions.create(
                        model="gpt-4o-mini",
                        messages=[
                            {"role": "system", "content": "You answer only from provided sources and include citations."},
                            {"role": "user", "content": dyn_prompt},
                        ],
                        temperature=0.1,
                        max_tokens=700,
                        stream=True,
                    )

                    full_answer = ""

                    if user_language == "fr":
                        for chunk in stream:
                            try:
                                if chunk.choices and len(chunk.choices) > 0:
                                    delta = chunk.choices[0].delta
                                    if hasattr(delta, "content") and delta.content:
                                        full_answer += delta.content
                            except Exception as chunk_error:
                                print(f"[DYNAMIC STREAM] Error processing chunk: {chunk_error}")
                                continue

                        full_answer = re.sub(r"\s+", " ", full_answer).strip()
                        full_answer = translate_text(full_answer, "fr", "en")
                        words = full_answer.split()
                        for i, word in enumerate(words):
                            yield f"data: {json.dumps({'type': 'text', 'content': word + (' ' if i < len(words)-1 else '')})}\n\n"
                    else:
                        for chunk in stream:
                            try:
                                if chunk.choices and len(chunk.choices) > 0:
                                    delta = chunk.choices[0].delta
                                    if hasattr(delta, "content") and delta.content:
                                        yield f"data: {json.dumps({'type': 'text', 'content': delta.content})}\n\n"
                            except Exception as chunk_error:
                                print(f"[DYNAMIC STREAM] Error processing chunk: {chunk_error}")
                                continue

                formatted_results = [
                    {"score": 1.0, "content": s.get("title", ""), "category": "dynamic_search", "topic": "official_search", "source_url": s.get("url", "")}
                    for s in sources
                    if s.get("url")
                ]
                yield f"data: {json.dumps({'type': 'results', 'results': formatted_results})}\n\n"
                yield f"data: {json.dumps({'type': 'done'})}\n\n"
                return

            # Handle out-of-scope questions (only after dynamic router says "not dynamic")
            if intent_type == "out_of_scope" or category == "none":
                print(f"[STREAM] Question is out of scope")
                answer_en = "I'm the City of Kingston 311 assistant. I couldn't find that in our policies knowledge base. You can try asking about City services/policies, or contact 311 at 613-546-0000 for assistance."
                answer = translate_text(answer_en, user_language, "en") if user_language == "fr" else answer_en
                yield f"data: {json.dumps({'type': 'text', 'content': answer, 'done': True})}\n\n"
                return
            
            # Handle live lookups
            if intent_type == "live_status_lookup":
                calendar_url = "https://www.cityofkingston.ca/garbage-and-recycling/collection-calendar/"
                if user_address:
                    answer_en = f"I've noted your address: {user_address}. To find your specific garbage collection day, please visit the City's official waste collection calendar at {calendar_url} and enter your address there. The calendar will show you your exact collection schedule."
                else:
                    answer_en = f"Garbage collection days depend on your address. Please provide your address (e.g., '576 Division Street') and I'll direct you to the City's official collection calendar where you can check your specific schedule: {calendar_url}"
                answer = translate_text(answer_en, user_language, "en") if user_language == "fr" else answer_en
                yield f"data: {json.dumps({'type': 'text', 'content': answer, 'done': True})}\n\n"
                return
            
            # Generate embedding and query Pinecone
            print(f"[STREAM] Generating embedding...")
            embedding_response = openai_client.embeddings.create(
                model="text-embedding-3-small",
                input=request.query
            )
            query_embedding = embedding_response.data[0].embedding
            print(f"[STREAM] Querying Pinecone...")
            
            results = index.query(
                vector=query_embedding,
                top_k=request.top_k * 3,
                include_metadata=True
            )
            print(f"[STREAM] Found {len(results.matches)} matches")

            formatted_results, context_parts = _select_context_and_results(
                results.matches,
                expected_category=category,
                top_k=request.top_k,
            )
            
            # Quick fallback if no context found
            if not context_parts:
                print(f"[STREAM] No RAG context - falling back to official-site search")
                sources, dyn_context = build_dynamic_context(request.query, max_results=4)
                if dyn_context:
                    # Reuse dynamic prompt (non-guessing, citations)
                    dyn_prompt = f"""You are the City of Kingston 311 assistant.
Answer the user's question using ONLY the official sources provided below.

Rules:
1) If the sources do not contain the answer, say: "I couldn't confirm that on official City of Kingston sources."
2) Do NOT guess. Do NOT use outside knowledge.
3) Include citations like [1], [2] matching the source numbers.

Question: {request.query}

Official sources:
{dyn_context}
"""
                    stream = openai_client.chat.completions.create(
                        model="gpt-4o-mini",
                        messages=[
                            {"role": "system", "content": "You answer only from provided sources and include citations."},
                            {"role": "user", "content": dyn_prompt},
                        ],
                        temperature=0.1,
                        max_tokens=700,
                        stream=True,
                    )
                    full_answer = ""
                    if user_language == "fr":
                        for chunk in stream:
                            if chunk.choices and len(chunk.choices) > 0:
                                delta = chunk.choices[0].delta
                                if hasattr(delta, "content") and delta.content:
                                    full_answer += delta.content
                        full_answer = re.sub(r"\s+", " ", full_answer).strip()
                        full_answer = translate_text(full_answer, "fr", "en")
                        words = full_answer.split()
                        for i, word in enumerate(words):
                            yield f"data: {json.dumps({'type': 'text', 'content': word + (' ' if i < len(words)-1 else '')})}\n\n"
                    else:
                        for chunk in stream:
                            if chunk.choices and len(chunk.choices) > 0:
                                delta = chunk.choices[0].delta
                                if hasattr(delta, "content") and delta.content:
                                    yield f"data: {json.dumps({'type': 'text', 'content': delta.content})}\n\n"

                    formatted_results = [
                        {"score": 1.0, "content": s.get("title", ""), "category": "dynamic_search", "topic": "official_search", "source_url": s.get("url", "")}
                        for s in sources
                        if s.get("url")
                    ]
                    yield f"data: {json.dumps({'type': 'results', 'results': formatted_results})}\n\n"
                    yield f"data: {json.dumps({'type': 'done'})}\n\n"
                    return

                fallback_msg_en = "I couldn't find official information about that. Please try rephrasing, or contact 311 at 613-546-0000 for assistance."
                fallback_msg = translate_text(fallback_msg_en, user_language, "en") if user_language == "fr" else fallback_msg_en
                yield f"data: {json.dumps({'type': 'text', 'content': fallback_msg, 'done': True})}\n\n"
                return
            
            # Check if context is relevant - quick validation before generating answer
            print(f"[STREAM] Checking context relevance...")
            context_relevance = check_context_relevance(request.query, "\n\n".join(context_parts[:2]), category)
            if not context_relevance:
                print(f"[STREAM] Context not relevant - falling back to official-site search")
                sources, dyn_context = build_dynamic_context(request.query, max_results=4)
                if dyn_context:
                    dyn_prompt = f"""You are the City of Kingston 311 assistant.
Answer the user's question using ONLY the official sources provided below.

Rules:
1) If the sources do not contain the answer, say: "I couldn't confirm that on official City of Kingston sources."
2) Do NOT guess. Do NOT use outside knowledge.
3) Include citations like [1], [2] matching the source numbers.

Question: {request.query}

Official sources:
{dyn_context}
"""
                    stream = openai_client.chat.completions.create(
                        model="gpt-4o-mini",
                        messages=[
                            {"role": "system", "content": "You answer only from provided sources and include citations."},
                            {"role": "user", "content": dyn_prompt},
                        ],
                        temperature=0.1,
                        max_tokens=700,
                        stream=True,
                    )
                    full_answer = ""
                    if user_language == "fr":
                        for chunk in stream:
                            if chunk.choices and len(chunk.choices) > 0:
                                delta = chunk.choices[0].delta
                                if hasattr(delta, "content") and delta.content:
                                    full_answer += delta.content
                        full_answer = re.sub(r"\s+", " ", full_answer).strip()
                        full_answer = translate_text(full_answer, "fr", "en")
                        words = full_answer.split()
                        for i, word in enumerate(words):
                            yield f"data: {json.dumps({'type': 'text', 'content': word + (' ' if i < len(words)-1 else '')})}\n\n"
                    else:
                        for chunk in stream:
                            if chunk.choices and len(chunk.choices) > 0:
                                delta = chunk.choices[0].delta
                                if hasattr(delta, "content") and delta.content:
                                    yield f"data: {json.dumps({'type': 'text', 'content': delta.content})}\n\n"

                    formatted_results = [
                        {"score": 1.0, "content": s.get("title", ""), "category": "dynamic_search", "topic": "official_search", "source_url": s.get("url", "")}
                        for s in sources
                        if s.get("url")
                    ]
                    yield f"data: {json.dumps({'type': 'results', 'results': formatted_results})}\n\n"
                    yield f"data: {json.dumps({'type': 'done'})}\n\n"
                    return

                fallback_msg_en = "I couldn't confirm that on official City of Kingston sources. Please contact 311 at 613-546-0000 for assistance."
                fallback_msg = translate_text(fallback_msg_en, user_language, "en") if user_language == "fr" else fallback_msg_en
                yield f"data: {json.dumps({'type': 'text', 'content': fallback_msg, 'done': True})}\n\n"
                return
            
            context = "\n\n".join(context_parts)
            template = get_prompt_template(category)
            prompt_text = template.format(context=context, question=request.query)
            
            print(f"[STREAM] Starting OpenAI stream...")
            # Stream using OpenAI directly
            stream = openai_client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": "You are a helpful assistant for the City of Kingston 311 service. Do not include mailing address information (PO Box 640) or cheque payment instructions in your responses."},
                    {"role": "user", "content": prompt_text}
                ],
                temperature=0.2,
                max_tokens=800,
                stream=True
            )
            
            full_answer = ""
            chunk_count = 0
            
            # If French, we need to collect full answer before translating
            if user_language == "fr":
                # Collect all chunks first
                for chunk in stream:
                    try:
                        if chunk.choices and len(chunk.choices) > 0:
                            delta = chunk.choices[0].delta
                            if hasattr(delta, 'content') and delta.content:
                                content = delta.content
                                full_answer += content
                                chunk_count += 1
                    except Exception as chunk_error:
                        print(f"[STREAM] Error processing chunk: {chunk_error}")
                        continue
                
                print(f"[STREAM] Collected {chunk_count} chunks, total length: {len(full_answer)}")
                
                # Clean up the full answer
                full_answer = re.sub(r'\s+', ' ', full_answer).strip()
                # Remove mailing address information
                full_answer = re.sub(r'Make your cheque payable to City of Kingston and mail it to.*?Kingston, ON K7L 4X1.*?(?=\n\n|\Z)', '', full_answer, flags=re.DOTALL | re.IGNORECASE)
                full_answer = re.sub(r'Make your cheque payable.*?PO Box 640.*?Kingston, ON K7L 4X1.*?(?=\n\n|\Z)', '', full_answer, flags=re.DOTALL | re.IGNORECASE)
                
                # Translate to French
                print(f"[STREAM] Translating answer to French...")
                full_answer = translate_text(full_answer, "fr", "en")
                
                # Stream the translated answer
                # Split into words for smoother streaming effect
                words = full_answer.split()
                for i, word in enumerate(words):
                    content = word + (" " if i < len(words) - 1 else "")
                    yield f"data: {json.dumps({'type': 'text', 'content': content})}\n\n"
            else:
                # English - stream normally
                for chunk in stream:
                    try:
                        if chunk.choices and len(chunk.choices) > 0:
                            delta = chunk.choices[0].delta
                            if hasattr(delta, 'content') and delta.content:
                                content = delta.content
                                full_answer += content
                                chunk_count += 1
                                # Send content as-is (frontend will clean spaces)
                                if content:
                                    yield f"data: {json.dumps({'type': 'text', 'content': content})}\n\n"
                    except Exception as chunk_error:
                        print(f"[STREAM] Error processing chunk: {chunk_error}")
                        continue
                
                print(f"[STREAM] Streamed {chunk_count} chunks, total length: {len(full_answer)}")
                
                # Clean up the full answer
                full_answer = re.sub(r'\s+', ' ', full_answer).strip()
                # Remove mailing address information
                full_answer = re.sub(r'Make your cheque payable to City of Kingston and mail it to.*?Kingston, ON K7L 4X1.*?(?=\n\n|\Z)', '', full_answer, flags=re.DOTALL | re.IGNORECASE)
                full_answer = re.sub(r'Make your cheque payable.*?PO Box 640.*?Kingston, ON K7L 4X1.*?(?=\n\n|\Z)', '', full_answer, flags=re.DOTALL | re.IGNORECASE)
            
            # AGENT 3: Validate the answer actually answers the question
            print(f"[AGENT 3] Validating answer...")
            validation_result = validate_answer_relevance(request.query, full_answer, category)
            print(f"[AGENT 3] Validation result: {validation_result}")
            
            if not validation_result["is_relevant"]:
                # Answer doesn't match question - send correction message
                print(f"[AGENT 3] Answer is not relevant, sending correction")
                correction_en = "\n\nI don't have specific information about that in our knowledge base. Please contact 311 at 613-546-0000 for assistance with this question."
                correction = translate_text(correction_en, user_language, "en") if user_language == "fr" else correction_en
                yield f"data: {json.dumps({'type': 'text', 'content': correction})}\n\n"
                formatted_results = []
            
            # Send results metadata
            yield f"data: {json.dumps({'type': 'results', 'results': formatted_results})}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
                
        except Exception as e:
            error_msg = str(e)
            error_trace = traceback.format_exc()
            print(f"[STREAM ERROR] {error_msg}")
            print(f"[STREAM ERROR TRACEBACK] {error_trace}")
            yield f"data: {json.dumps({'type': 'error', 'content': error_msg})}\n\n"
    
    return StreamingResponse(generate(), media_type="text/event-stream")


@app.post("/query", response_model=QueryResponse)
async def query_pinecone(request: QueryRequest):
    """Query Pinecone for relevant policy information using LangChain for answer generation"""
    try:
        # STEP 1: Classify question intent (returns intent_type and category)
        intent_type, category = classify_question_intent(request.query)
        
        # STEP 2: Extract address if present
        user_address = extract_address_clean(request.query)
        
        # STEP 3: Determine workflow state
        workflow_state = None
        requires_address = False
        
        if intent_type == "live_status_lookup":
            if user_address:
                workflow_state = "ADDRESS_RECEIVED"
            else:
                workflow_state = "WAITING_FOR_ADDRESS"
                requires_address = True
        
        # STEP 4: Handle live lookup questions (DO NOT use RAG)
        if intent_type == "live_status_lookup":
            calendar_url = "https://www.cityofkingston.ca/garbage-and-recycling/collection-calendar/"
            
            if user_address:
                # Address provided - acknowledge and redirect to official source
                # Note: We cannot directly query the City's calendar API, so we redirect to their tool
                answer = f"I've noted your address: {user_address}. To find your specific garbage collection day, please visit the City's official waste collection calendar at {calendar_url} and enter your address there. The calendar will show you your exact collection schedule."
                formatted_results = []
            else:
                # No address - ask for it
                answer = "Garbage collection days depend on your address. Please provide your address (e.g., '576 Division Street') so I can direct you to check your specific collection schedule."
                formatted_results = []
            
            return QueryResponse(
                query=request.query,
                answer=answer,
                results=formatted_results,
                intent=intent_type,
                requires_address=requires_address,
                workflow_state=workflow_state
            )
        
        # STEP 5: Handle policy questions (USE RAG) - Simple database lookup
        # Check if this is a greeting - return simple greeting response
        is_greeting = is_greeting_or_simple_query(request.query)
        if is_greeting:
            greeting_responses = [
                "Hello! I'm the City of Kingston 311 assistant. I can help answer questions about city services, policies, and information. What can I help you with today?",
                "Hi! How can I help you with City of Kingston services today?",
                "Hey! I'm here to help with questions about Kingston city services. What would you like to know?"
            ]
            import random
            answer = random.choice(greeting_responses)
            return QueryResponse(
                query=request.query,
                answer=answer,
                results=[],
                intent=intent_type,
                requires_address=requires_address,
                workflow_state=workflow_state
            )
        
        # Generate embedding for query
        embedding_response = openai_client.embeddings.create(
            model="text-embedding-3-small",
            input=request.query
        )
        query_embedding = embedding_response.data[0].embedding
        
        # Query Pinecone - Get more results, then filter by category
        results = index.query(
            vector=query_embedding,
            top_k=request.top_k * 3,  # Get more to filter from
            include_metadata=True
        )

        formatted_results, context_parts = _select_context_and_results(
            results.matches,
            expected_category=category,
            top_k=request.top_k,
        )
        
        # Generate answer using LangChain - with category-specific prompt
        if context_parts:
            context = "\n\n".join(context_parts)
            
            # Create category-specific chain
            llm_chain = create_llm_chain(category)
            
            result = llm_chain.invoke({
                "context": context,
                "question": request.query
            })
            answer = result.content if hasattr(result, 'content') else str(result)
            
            # Remove mailing address information from answer
            answer = re.sub(r'Make your cheque payable to City of Kingston and mail it to.*?Kingston, ON K7L 4X1.*?(?=\n\n|\Z)', '', answer, flags=re.DOTALL | re.IGNORECASE)
            answer = re.sub(r'Make your cheque payable.*?PO Box 640.*?Kingston, ON K7L 4X1.*?(?=\n\n|\Z)', '', answer, flags=re.DOTALL | re.IGNORECASE)
            
            # Check if answer is saying context is missing (common LLM error)
            if "context" in answer.lower() and ("missing" in answer.lower() or "not provided" in answer.lower() or "seems that the context" in answer.lower()):
                # LLM is ignoring context - regenerate with explicit instruction
                strict_prompt = PromptTemplate(
                    template="""You MUST answer using the context provided below. The context contains the answer - use it.

Context:
{context}

Question: {question}

Answer the question using the information from the context above. Do not say the context is missing - it is provided above:""",
                    input_variables=["context", "question"]
                )
                strict_chain = strict_prompt | llm
                result = strict_chain.invoke({"context": context, "question": request.query})
                answer = result.content if hasattr(result, 'content') else str(result)
            
            # If it's a greeting, don't include additional information
            if is_greeting:
                formatted_results = []
            
            # Add form/application links only if mentioned in answer and we have source URLs
            source_urls = [r.get("source_url", "") for r in formatted_results if r.get("source_url")]
            forms_mentioned = any(keyword in answer.lower() for keyword in ["form", "application", "apply", "submit"])
            
            if forms_mentioned and source_urls and not is_greeting:
                # Add application link if forms are mentioned
                if "http" not in answer:
                    answer += f"\n\nTo apply, visit: {source_urls[0]}"
            
            # VALIDATION: Check that answer doesn't mention unrelated categories
            unrelated_categories = {
                "parking": ["garbage", "waste", "collection calendar", "recycling"],
                "property_tax": ["garbage", "waste", "parking", "collection"],
                "waste_collection": ["parking permit", "property tax"],
                "hazardous_waste": ["parking", "tax", "collection calendar"],
                "fire_permits": ["garbage", "parking", "tax"],
                "noise": ["garbage", "parking", "tax", "collection"]
            }
            
            if category in unrelated_categories:
                answer_lower = answer.lower()
                for forbidden_term in unrelated_categories[category]:
                    if forbidden_term in answer_lower and category not in ["waste_collection"]:  # Allow some overlap for waste
                        # Answer mentions unrelated topic - regenerate with stricter prompt
                        strict_template = f"""Answer ONLY about {category.replace('_', ' ')}. Do NOT mention garbage, waste collection, parking permits, property tax, or any other topics.

Context:
{{context}}

Question: {{question}}

Answer (ONLY {category.replace('_', ' ')}):"""
                        strict_prompt = PromptTemplate(template=strict_template, input_variables=["context", "question"])
                        strict_chain = strict_prompt | llm
                        result = strict_chain.invoke({"context": context, "question": request.query})
                        answer = result.content if hasattr(result, 'content') else str(result)
                        break
        else:
            answer = "I couldn't find specific information about that. Please try rephrasing your question or contact 311 at 613-546-0000."
        
        return QueryResponse(
            query=request.query,
            answer=answer,
            results=formatted_results,
            intent=intent_type,
            requires_address=requires_address,
            workflow_state=workflow_state
        )
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error querying: {str(e)}")


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    try:
        # Check Pinecone connection
        stats = index.describe_index_stats()
        return {
            "status": "healthy",
            "pinecone": "connected",
            "total_vectors": stats.total_vector_count
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "error": str(e)
        }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
