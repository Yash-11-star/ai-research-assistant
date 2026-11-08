import 'dotenv/config';
import app from './app.js';

const PORT = process.env.PORT || 3001;

const server = app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use — is another copy of the server running? (lsof -i :${PORT})`);
    process.exit(1);
  }
  throw err;
});
