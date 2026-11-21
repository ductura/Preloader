import { main } from '../sve-lokalno.mjs';
import { frontendTargets, planFrontends, startFrontends } from './frontends.mjs';

try {
  const frontends = planFrontends(process.env);
  await main({ ...process.env, ...frontendTargets(frontends) });
  await startFrontends(frontends, process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
