"""
FastAPI Backend for City of Kingston 311 Chatbot
Using LangChain for RAG pipeline
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional, Tuple
import os
import re
import requests
from bs4 import BeautifulSoup
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
allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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

def classify_question_intent(query: str) -> Tuple[str, str]:
    """
    Classify question into EXACTLY ONE intent category.
    Returns: (intent_type, category)
    - intent_type: 'live_status_lookup' or 'policy_explanatory'
    - category: specific category for filtering (waste_collection, parking, property_tax, etc.)
    """
    query_lower = query.lower()
    
    # Live lookup indicators (schedule questions)
    live_keywords = [
        "when is", "when is my", "when does my", "what day is my", "what day is",
        "today", "tomorrow", "this week", "next week",
        "my address", "my collection day", "my pickup day",
        "check for", "look up", "find my"
    ]
    
    # Address patterns
    address_patterns = [
        r"\d+\s+\w+\s+(street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|way|court|ct)",
        r"division", r"kingston", r"\d+\s+\w+"
    ]
    
    # Check for live lookup first
    if any(re.search(pattern, query_lower) for pattern in address_patterns):
        return ("live_status_lookup", "waste_collection")
    
    if any(keyword in query_lower for keyword in live_keywords):
        return ("live_status_lookup", "waste_collection")
    
    # Policy question - classify into specific category
    # Parking
    if any(term in query_lower for term in ["parking permit", "parking", "permit", "monthly parking", "residential parking"]):
        return ("policy_explanatory", "parking")
    
    # Property Tax
    if any(term in query_lower for term in ["property tax", "tax payment", "tax due", "tax bill", "pay taxes"]):
        return ("policy_explanatory", "property_tax")
    
    # Waste Collection Rules
    if any(term in query_lower for term in ["blue box", "grey box", "green bin", "what goes", "recycling", "garbage", "waste", "cart", "collection rules"]):
        return ("policy_explanatory", "waste_collection")
    
    # Hazardous Waste
    if any(term in query_lower for term in ["hazardous waste", "karc", "dispose", "batteries", "drop off"]):
        return ("policy_explanatory", "hazardous_waste")
    
    # Fire Permits
    if any(term in query_lower for term in ["fire permit", "open air fire", "burn", "fire pit"]):
        return ("policy_explanatory", "fire_permits")
    
    # Noise
    if any(term in query_lower for term in ["noise", "quiet hours", "bylaw", "nuisance", "complaint"]):
        return ("policy_explanatory", "noise")
    
    # Default to waste_collection for general questions
    return ("policy_explanatory", "waste_collection")

def is_greeting_or_simple_query(query: str) -> bool:
    """Detect if query is a greeting or simple interaction that doesn't need additional information"""
    query_lower = query.lower().strip()
    
    # Greeting patterns
    greeting_patterns = [
        "hi", "hello", "hey", "good morning", "good afternoon", "good evening",
        "how are you", "what can you do", "what do you do", "help me",
        "what is this", "who are you", "introduce yourself"
    ]
    
    # Simple acknowledgment patterns
    simple_patterns = [
        "thanks", "thank you", "ok", "okay", "got it", "understood",
        "that's helpful", "that helps"
    ]
    
    # Check if it's just a greeting
    if any(query_lower.startswith(pattern) or query_lower == pattern for pattern in greeting_patterns):
        return True
    
    # Check if it's a very short query (likely greeting)
    if len(query_lower.split()) <= 3 and any(word in query_lower for word in ["hi", "hello", "hey", "help"]):
        return True
    
    # Check for simple acknowledgments
    if any(pattern in query_lower for pattern in simple_patterns):
        return True
    
    return False

def extract_address_clean(query: str) -> Optional[str]:
    """Extract and clean address from query"""
    # Remove common phrases
    query_clean = query.lower()
    query_clean = re.sub(r"(check for|look up|find|my address is|address is|address:)", "", query_clean)
    query_clean = query_clean.strip()
    
    # Look for address patterns
    address_pattern = r"(\d+\s+[\w\s]+(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|way|court|ct|division|kingston))"
    match = re.search(address_pattern, query_clean, re.IGNORECASE)
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
                if word not in ["check", "for", "this", "my", "address", "is"]:
                    address_parts.append(word)
            if len(address_parts) >= 2:
                return " ".join(address_parts).strip()
    
    return None


class QueryRequest(BaseModel):
    query: str
    top_k: Optional[int] = 5
    session_id: Optional[str] = None  # For tracking conversation state


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


@app.post("/query/stream")
async def query_pinecone_stream(request: QueryRequest):
    """Streaming endpoint for real-time response generation"""
    async def generate():
        try:
            import traceback
            print(f"[STREAM] Received query: {request.query}")
            
            # Classify intent
            intent_type, category = classify_question_intent(request.query)
            user_address = extract_address_clean(request.query)
            print(f"[STREAM] Intent: {intent_type}, Category: {category}")
            
            # Handle greetings
            if is_greeting_or_simple_query(request.query):
                greeting = "Hello! I'm the City of Kingston 311 assistant. How can I help you today?"
                yield f"data: {json.dumps({'type': 'text', 'content': greeting, 'done': True})}\n\n"
                return
            
            # Handle live lookups
            if intent_type == "live_status_lookup":
                if user_address:
                    answer = f"I've noted your address: {user_address}. To find your specific garbage collection day, please visit: https://www.cityofkingston.ca/garbage-and-recycling/collection-calendar/"
                else:
                    answer = "Garbage collection days depend on your address. Please provide your address so I can direct you to check your schedule."
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
            
            category_matches = [
                match for match in results.matches 
                if match.metadata.get("category", "").lower() == category.lower()
            ]
            
            formatted_results = []
            context_parts = []
            
            sorted_matches = sorted(
                category_matches[:request.top_k * 2] if category_matches else results.matches[:request.top_k * 2],
                key=lambda x: -x.score
            )
            
            for match in sorted_matches:
                content = match.metadata.get("content", "")
                if "section menu" in content.lower() or ("learn more" in content.lower() and len(content) < 100):
                    continue
                formatted_results.append({
                    "score": match.score,
                    "content": content[:500],
                    "category": match.metadata.get("category", ""),
                    "topic": match.metadata.get("topic", ""),
                    "source_url": match.metadata.get("source_url", "")
                })
                context_parts.append(content[:1500])
            
            if context_parts:
                context = "\n\n".join(context_parts)
                template = get_prompt_template(category)
                prompt_text = template.format(context=context, question=request.query)
                
                print(f"[STREAM] Starting OpenAI stream...")
                # Stream using OpenAI directly
                stream = openai_client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[
                        {"role": "system", "content": "You are a helpful assistant for the City of Kingston 311 service."},
                        {"role": "user", "content": prompt_text}
                    ],
                    temperature=0.2,
                    max_tokens=800,
                    stream=True
                )
                
                full_answer = ""
                chunk_count = 0
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
                
                # Send results metadata
                yield f"data: {json.dumps({'type': 'results', 'results': formatted_results})}\n\n"
                yield f"data: {json.dumps({'type': 'done'})}\n\n"
            else:
                print(f"[STREAM] No context found")
                yield f"data: {json.dumps({'type': 'text', 'content': \"I couldn't find specific information. Please contact 311 at 613-546-0000.\", 'done': True})}\n\n"
                
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
        
        # CRITICAL: Filter to ONLY the classified category
        category_matches = [
            match for match in results.matches 
            if match.metadata.get("category", "").lower() == category.lower()
        ]
        
        # Format retrieved documents - Use category-filtered matches
        formatted_results = []
        context_parts = []
        
        # Use category matches if available, otherwise use all (fallback)
        if category_matches:
            sorted_matches = sorted(category_matches[:request.top_k * 2], key=lambda x: -x.score)  # Get more for comprehensive answer
        else:
            sorted_matches = sorted(results.matches[:request.top_k * 2], key=lambda x: -x.score)
        
        for match in sorted_matches:
            content = match.metadata.get("content", "")
            # Skip menu/navigation content
            if "section menu" in content.lower() or "learn more" in content.lower() and len(content) < 100:
                continue
            formatted_results.append({
                "score": match.score,
                "content": content[:500],
                "category": match.metadata.get("category", ""),
                "topic": match.metadata.get("topic", ""),
                "source_url": match.metadata.get("source_url", "")
            })
            # Use longer context for comprehensive answers
            context_length = 1500
            context_parts.append(content[:context_length])
        
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
