import type { APIRoute } from 'astro';
import { Pinecone } from '@pinecone-database/pinecone';
import Groq from 'groq-sdk';

const pc = new Pinecone({ apiKey: import.meta.env.PINECONE_API_KEY || process.env.PINECONE_API_KEY || '' });
const groq = new Groq({ apiKey: import.meta.env.GROQ_API_KEY || process.env.GROQ_API_KEY || '' });
const INDEX_NAME = 'mindstack';

export const GET: APIRoute = async ({ url }) => {
  try {
    const userQuery = url.searchParams.get('q')?.trim();
    if (!userQuery) return new Response(JSON.stringify({ error: 'Query is empty' }), { status: 400 });

    console.log(`📡 [SENDING] Raw query text to Pinecone: "${userQuery}"`);

    const index = pc.index(INDEX_NAME);

    const searchResponse = await index.searchRecords({
      query: {
        inputs: { text: userQuery },
        topK: 5
      },
      fields: ['text', 'enhancedSummary', 'entities', 'sentiment', 'createdAt']
    });

    // =============================================================
    // 🔍 THE DIAGNOSTIC PRINT
    // =============================================================
    console.log('👀 [RAW PINECONE RESPONSE OBJECT]:');
    console.log(JSON.stringify(searchResponse, null, 2));
    // =============================================================

   // ==========================================
    // STEP 2: PARSE REVEALED SCHEMA
    // ==========================================
    const hits = searchResponse.result?.hits || [];
    console.log(`🎯 [PARSER SNAPSHOT]: Extracting ${hits.length} records matching the revealed structure.`);

    const relatedThoughts = hits.map((hit: any) => {
      const dataFields = hit.fields || {};
      return {
        id: hit._id || '', // Maps from Pinecone's unique '_id' signature
        score: hit._score ?? 1.0, // Maps from Pinecone's unique '_score' signature
        text: dataFields.text || '',
        summary: dataFields.enhancedSummary || '',
        entities: dataFields.entities || [],
        sentiment: dataFields.sentiment || 'neutral',
        createdAt: dataFields.createdAt || ''
      };
    });

    const contextBlock = relatedThoughts.length > 0 
      ? relatedThoughts.map((t) => `- ${t.text}`).join('\n')
      : 'No matches found.';

    const synthesisCompletion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: 'You are a helpful memory assistant.' },
        { role: 'user', content: `User query: "${userQuery}"\n\nThoughts:\n${contextBlock}` }
      ],
      temperature: 0.2
    });

    return new Response(JSON.stringify({
      success: true,
      synthesis: synthesisCompletion.choices[0]?.message?.content || '',
      relatedThoughts
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('❌ [CRITICAL SEARCH ERROR]:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};