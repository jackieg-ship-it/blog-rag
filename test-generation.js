import "dotenv/config";
import fs from "fs";

function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    magnitudeA += vecA[i] * vecA[i];
    magnitudeB += vecB[i] * vecB[i];
  }

  magnitudeA = Math.sqrt(magnitudeA);
  magnitudeB = Math.sqrt(magnitudeB);

  return dotProduct / (magnitudeA * magnitudeB);
}

async function retrieveTopChunks(question, allChunks, topN = 3, maxPerPost = 2) {
  const response = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.VOYAGE_API_KEY}`
    },
    body: JSON.stringify({
      input: [question],
      model: "voyage-4-lite"
    })
  });

  const data = await response.json();
  const questionEmbedding = data.data[0].embedding;

  const scored = allChunks.map(chunk => ({
    ...chunk,
    similarity: cosineSimilarity(questionEmbedding, chunk.embedding)
  }));

  scored.sort((a, b) => b.similarity - a.similarity);

  const selected = [];
  const countPerPost = {};

  for (const chunk of scored) {
    const count = countPerPost[chunk.postTitle] || 0;
    if (count >= maxPerPost) continue;

    selected.push(chunk);
    countPerPost[chunk.postTitle] = count + 1;

    if (selected.length >= topN) break;
  }

  return selected;
}

async function generateAnswer(question, topChunks) {
  if (topChunks.length === 0 || topChunks[0].similarity < 0.4) {
    return { answer: "No relevant results found in the blog.", sources: [] };
  }

  const context = topChunks
    .map((chunk, i) => `[${i + 1}] From "${chunk.postTitle}":\n${chunk.text}`)
    .join("\n\n");

  const prompt = `You are answering questions using ONLY the blog excerpts provided below. Do not use outside knowledge. If the excerpts don't actually contain a relevant answer, respond exactly with: "No relevant results found in the blog."

Answer in a neutral, third-person tone (e.g. "The blog explains..." or "According to the post...") rather than first person.

Blog excerpts:
${context}

Question: ${question}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }]
      })
    }
  );

  const data = await response.json();

  if (!data.candidates) {
    console.error("Gemini API error:", JSON.stringify(data));
    throw new Error("Generation request failed — check your API key and model name.");
  }

  const answer = data.candidates[0].content.parts[0].text;
  const sources = [...new Map(topChunks.map(c => [c.postUrl, { title: c.postTitle, url: c.postUrl }])).values()];

  return { answer, sources };
}

// --- Run the full pipeline end to end ---
const allChunks = JSON.parse(fs.readFileSync("index.json", "utf-8"));

const question = "How can I be a better pm than I am now?"; // <-- change this to test other questions

const topChunks = await retrieveTopChunks(question, allChunks);
const { answer, sources } = await generateAnswer(question, topChunks);

console.log(`\nQuestion: "${question}"\n`);
console.log(`Answer:\n${answer}\n`);
console.log("Sources:");
sources.forEach(s => console.log(`- ${s.title}: ${s.url}`));
