// Deploy target, from env SERVER (inlined into client and server bundles by next.config.ts).
// `vercel`: server.ts does not run there, so there is no Socket.IO (online rooms, ranked), no writable
// disk (img2threejs studio jobs in SQLite, .glb uploads) and no long-lived process (in-memory server
// monitoring). Those features are hidden in the game and the CMS, and their APIs answer 404.
export const IS_VERCEL = process.env.SERVER === 'vercel';
