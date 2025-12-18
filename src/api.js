import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import path from 'path';
import fs from 'fs/promises';

dotenv.config();

const app = express();
const port = process.env.API_PORT || 3000;
const apiKey = process.env.API_KEY;

// Serve static documentation
app.use(express.static(path.join(process.cwd(), 'docs')));

// Middleware for API Key Authentication for /send endpoint
const apiKeyAuth = (req, res, next) => {
  if (req.path.startsWith('/send')) {
    const providedApiKey = req.headers['x-api-key'];
    if (!providedApiKey || providedApiKey !== apiKey) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }
  next();
};

app.use(cors());
app.use(express.json());
app.use(apiKeyAuth);


const startApi = (sock) => {
    // API route
  app.post('/send', async (req, res) => {
    const { number, groupId, type, payload } = req.body;

    if (!number && !groupId) {
      return res.status(400).json({ error: 'Either "number" or "groupId" must be provided.' });
    }

    const jid = number ? `${number}@s.whatsapp.net` : groupId;

    try {
      switch (type) {
        case 'text':
          if (!payload.message) {
            return res.status(400).json({ error: 'Payload for text must contain a "message".' });
          }
          await sock.sendMessage(jid, { text: payload.message });
          break;
        case 'image':
          if (!payload.url) {
            return res.status(400).json({ error: 'Payload for image must contain a "url".' });
          }
          await sock.sendMessage(jid, { image: { url: payload.url }, caption: payload.caption });
          break;
        case 'document':
            if (!payload.url || !payload.fileName) {
                return res.status(400).json({ error: 'Payload for document must contain a "url" and "fileName".' });
            }
            await sock.sendMessage(jid, {
                document: { url: payload.url },
                fileName: payload.fileName,
                mimetype: payload.mimetype
            });
            break;
        default:
          return res.status(400).json({ error: 'Invalid message type.' });
      }
      res.status(200).json({ success: true, message: 'Message sent successfully.' });
    } catch (error) {
      console.error('Failed to send message:', error);
      res.status(500).json({ success: false, error: 'Failed to send message.' });
    }
  });

  // New API route to browse the data folder
  app.get('/api/data', async (req, res) => {
    // API Key Authentication
    const providedApiKey = req.headers['x-api-key'];
    if (!providedApiKey || providedApiKey !== apiKey) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const baseDir = path.resolve(process.cwd(), 'data');
    const userPath = req.query.path || '';

    const targetPath = path.join(baseDir, userPath);

    // Security check: Resolve the path and ensure it's within the base 'data' directory.
    // This prevents path traversal attacks (e.g., /api/data?path=../)
    if (!path.resolve(targetPath).startsWith(baseDir)) {
      return res.status(403).json({ error: 'Forbidden: Access denied.' });
    }

    try {
      const dirEntries = await fs.readdir(targetPath, { withFileTypes: true });

      const contents = dirEntries.map(entry => ({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
      }));

      res.status(200).json(contents);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return res.status(404).json({ error: 'Not Found: The specified path does not exist.' });
      }
      console.error('Failed to read directory:', error);
      res.status(500).json({ error: 'Internal Server Error: Failed to read directory.' });
    }
  });

  // New API route to get a specific file from the data folder
  app.get('/api/data/file', async (req, res) => {
    // API Key Authentication
    const providedApiKey = req.headers['x-api-key'];
    if (!providedApiKey || providedApiKey !== apiKey) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const baseDir = path.resolve(process.cwd(), 'data');
    const userPath = req.query.path; // path is required

    if (!userPath) {
      return res.status(400).json({ error: 'Bad Request: The "path" query parameter is required.' });
    }

    const targetPath = path.join(baseDir, userPath);

    // Security check: Ensure the resolved path is within the base 'data' directory.
    if (!path.resolve(targetPath).startsWith(baseDir)) {
      return res.status(403).json({ error: 'Forbidden: Access denied.' });
    }

    try {
      // Check if the path exists and is a file
      const stats = await fs.stat(targetPath);
      if (!stats.isFile()) {
        return res.status(403).json({ error: 'Forbidden: The requested path is not a file.' });
      }

      // Let Express handle sending the file.
      // It sets the appropriate Content-Type header and streams the file.
      res.sendFile(targetPath);

    } catch (error) {
      // Handle cases where the file doesn't exist
      if (error.code === 'ENOENT') {
        return res.status(404).json({ error: 'Not Found: The specified file does not exist.' });
      }
      // Handle other potential errors
      console.error('Failed to access or send file:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // Documentation route
  app.get('/', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'docs', 'index.html'));
  });

  app.listen(port, () => {
    console.log(`WhatsApp API server listening on port ${port}`);
    console.log(`API documentation available at http://localhost:${port}`);
  });
};

export default startApi;
