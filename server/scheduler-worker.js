import {ScheduleStore,schedulingConfigured} from './schedules/store.js';
import {schedulerTick} from './schedules/worker.js';
if(!schedulingConfigured()||!process.env.OPENAI_API_KEY?.trim()){console.error('Scheduler needs DATABASE_URL, SCHEDULE_ENCRYPTION_KEY (32+ random characters), and OPENAI_API_KEY.');process.exitCode=1;}
else{
 const store=new ScheduleStore();const once=process.argv.includes('--once');let stopped=false;let timer;
 const stop=()=>{stopped=true;clearTimeout(timer);};process.on('SIGTERM',stop);process.on('SIGINT',stop);
 async function tick(){try{const result=await schedulerTick(store);console.log(`Scheduler tick completed: ${result.processed} run(s).`);}catch{console.error('Scheduler tick failed. Check database access, encryption key and worker configuration.');if(once)process.exitCode=1;}finally{if(once||stopped)await store.close();else timer=setTimeout(tick,30000);}}
 await tick();
}
