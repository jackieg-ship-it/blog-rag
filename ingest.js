// Load environment variables from .env
import "dotenv/config";
import fs from "fs";

const WP_BASE_URL = "https://jackiegreenfield.com/wp-json/wp/v2/posts";
const BATCH_SIZE = 20;
const BATCH_DELAY_MS = 65000; // wait ~65 seconds between batches (full rate-limit window + buffer)
const MIN_CHUNK_LENGTH = 45;

// --- Step 1: Fetch all posts from WordPress ---
async function fetchAllPosts() {
  let allPosts = [];
  let page = 1;

  while (true) {
    const response = await fetch(`${WP_BASE_URL}?per_page=50&page=${page}`);
    if (!response.ok) break; // stop once WordPress runs out of pages
    const posts = await response.json();
    if (posts.length === 0) break;
    allPosts = allPosts.concat(posts);
    console.log(`Fetched page ${page}, ${allPosts.length} posts so far`);
    page++;
  }

  return allPosts;
}

// --- Step 2: Chunk a single post's HTML content by H2/H3 headers ---
function chunkText(html, postTitle, postUrl) {
  const rawSections = html.split(/(?=<h[23][^>]*>)/);

  const chunks = rawSections.map(section => {
    const text = section
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return { text, postTitle, postUrl };
  });

  return chunks.filter(chunk => chunk.text.length >= MIN_CHUNK_LENGTH);
}

// --- Step 3: Embed chunks in batches via Voyage ---
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function embedBatchWithRetry(batch, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const response = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.VOYAGE_API_KEY}`
      },
      body: JSON.stringify({
        input: batch.map(chunk => chunk.text),
        model: "voyage-4-lite"
      })
    });

    const data = await response.json();

    if (data.data) {
      return data.data; // success
    }

    console.log(`Batch failed (attempt ${attempt}/${maxRetries}): ${data.detail || "unknown error"}`);
    if (attempt < maxRetries) {
      console.log("Waiting 60 seconds before retrying this batch...");
      await sleep(60000);
    } else {
      throw new Error("Batch failed after max retries.");
    }
  }
}

async function embedChunks(chunks) {
  const results = [];

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const embeddings = await embedBatchWithRetry(batch);

    batch.forEach((chunk, j) => {
      results.push({ ...chunk, embedding: embeddings[j].embedding });
    });

    console.log(`Embedded batch ${Math.floor(i / BATCH_SIZE) + 1}, ${results.length}/${chunks.length} chunks done`);

    // Save progress after every batch, so a later failure doesn't lose earlier work
    fs.writeFileSync("index.json", JSON.stringify(results, null, 2));

    if (i + BATCH_SIZE < chunks.length) {
      console.log("Pausing to respect rate limit...");
      await sleep(BATCH_DELAY_MS);
    }
  }

  return results;
}

// --- Main: run the whole pipeline ---
async function main() {
  console.log("Fetching posts from WordPress...");
  const posts = await fetchAllPosts();
  console.log(`Fetched ${posts.length} total posts.`);

  console.log("Chunking posts...");
  let allChunks = [];
  for (const post of posts) {
    const chunks = chunkText(post.content.rendered, post.title.rendered, post.link);
    allChunks = allChunks.concat(chunks);
  }
  console.log(`Created ${allChunks.length} chunks.`);

  console.log("Embedding chunks (this may take a minute)...");
  const embeddedChunks = await embedChunks(allChunks);

  fs.writeFileSync("index.json", JSON.stringify(embeddedChunks, null, 2));
  console.log(`Done! Saved ${embeddedChunks.length} embedded chunks to index.json`);
}

main().catch(err => console.error("Ingestion failed:", err));
