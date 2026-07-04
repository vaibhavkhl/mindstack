import type { APIRoute } from 'astro';
import { Pinecone } from '@pinecone-database/pinecone';
import Groq from 'groq-sdk';

const pc = new Pinecone({ 
  apiKey: import.meta.env.PINECONE_API_KEY || process.env.PINECONE_API_KEY || '' 
});

const groq = new Groq({ 
  apiKey: import.meta.env.GROQ_API_KEY || process.env.GROQ_API_KEY || '' 
});

const INDEX_NAME = 'mindstack';

export const POST: APIRoute = async ({ request }) => {
  try {
    const { thought } = await request.json();
    const cleanThought = thought?.trim();

    if (!cleanThought) {
      return new Response(JSON.stringify({ error: 'Thought cannot be empty' }), { status: 400 });
    }

    // Step 1: Structural metadata generation via Groq
    let chatCompletion;
    try {
      chatCompletion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'Analyze the user raw stream-of-consciousness thought. Return a JSON object with exactly two keys: "summary" (string, single sentence headline) and "entities" (array of strings, core concepts/technologies).'
          },
          { role: 'user', content: cleanThought }
        ],
        temperature: 0.2
      });
    } catch (groqError: any) {
      console.error('❌ [GROQ ERROR]: Structural analysis failed.');
      console.error(`Status: ${groqError.status} | Message: ${groqError.message}`);
      throw groqError; 
    }

    const parsedMetadata = JSON.parse(chatCompletion.choices[0]?.message?.content || '{}');
    console.log('🧠 [LLM SUMMARY EXTRACTION]:', parsedMetadata.summary || 'No summary generated');

    // Step 2: Directly pass raw text to Pinecone via integrated inference
    try {
      const index = pc.index(INDEX_NAME);
      const id = `thought_${crypto.randomUUID()}`;

      // upsertRecords flattens fields. Everything outside of 'id' and 'text' 
      // is automatically indexed as metadata attributes.
      await index.upsertRecords({
        records: [
          {
            id,
            text: cleanThought, // Configured embedding field map
            enhancedSummary: parsedMetadata.summary || '',
            entities: parsedMetadata.entities || [],
            createdAt: new Date().toISOString()
          }
        ]
      });

      console.log(`✅ [SUCCESS]: Integrated document saved to index "${INDEX_NAME}" with ID: ${id}`);
      
      return new Response(JSON.stringify({ 
        success: true, 
        id, 
        extracted: {
          summary: parsedMetadata.summary || '',
          entities: parsedMetadata.entities || []
        }
      }), { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });

    } catch (pineconeError: any) {
      console.error(`❌ [PINECONE INTEGRATED ERROR]: Data ingestion failed.`);
      console.error(`Ensure your index "${INDEX_NAME}" was created with an embedding model config.`);
      console.error(pineconeError);
      throw pineconeError;
    }

  } catch (error: any) {
    console.error('💥 [PIPELINE CRASHED]:', error.message);
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};