const { NestFactory } = await import('@nestjs/core');
const { SchedulerRegistry } = await import('@nestjs/schedule');
const { AppModule } = await import('./.e2e-build/src/app.module.js');

const app = await NestFactory.createApplicationContext(AppModule as never, { logger: false });
const registry = app.get(SchedulerRegistry);
const jobs = registry.getCronJobs();
console.log('JOBS ENREGISTRES :', [...jobs.keys()].join(',') || '(aucun)');
const job = jobs.get('invoice-overdue-sweep');
console.log('TACHE DE BALAYAGE PRESENTE :', job !== undefined);
await app.close();
