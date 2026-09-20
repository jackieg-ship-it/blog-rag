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

  // Walk through ranked results, capping how many come from the same post
  const selected = [];
  const countPerPost = {};

  for (const chunk of scored) {
    const count = countPerPost[chunk.postTitle] || 0;
    if (count >= maxPerPost) continue; // skip, this post is already well-represented

    selected.push(chunk);
    countPerPost[chunk.postTitle] = count + 1;

    if (selected.length >= topN) break;
  }

  return selected;
}

// --- Run the test ---
const allChunks = JSON.parse(fs.readFileSync("index.json", "utf-8"));

const question = "How can I build trust with my team?"; // <-- change this to test other questions

const topChunks = await retrieveTopChunks(question, allChunks);

console.log(`\nQuestion: "${question}"\n`);
topChunks.forEach((chunk, i) => {
  console.log(`--- Match ${i + 1} (similarity: ${chunk.similarity.toFixed(3)}) ---`);
  console.log(`From: "${chunk.postTitle}"`);
  console.log(chunk.text.slice(0, 200) + "...");
  console.log();
});
