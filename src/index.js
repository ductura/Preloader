import { createApp } from './app.js';
const port = Number(process.env.PORT ?? 3000);
createApp().listen(port, () => console.log(`Ductura preloader na http://localhost:${port}`));
