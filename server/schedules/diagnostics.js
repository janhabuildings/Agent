const known={
 SCHEDULE_DATABASE_URL:['database_url_invalid','Set DATABASE_URL to the PostgreSQL Internal Database URL from Render, not the PSQL Command or a dashboard URL. Paste it without surrounding quotes.'],
 '28P01':['database_auth_failed','PostgreSQL rejected the database login. Copy the current Internal Database URL from your Postgres service to BOTH Agent and the Cron Job, then redeploy.'],
 '28000':['database_auth_failed','PostgreSQL rejected the connection identity. Check the database credentials and connection permissions.'],
 '3D000':['database_not_found','The database named in DATABASE_URL does not exist. Copy the complete current connection URL from Render.'],
 '42501':['database_permission_denied','The database user cannot create or access scheduling tables. Use the database owner connection for the dedicated scheduling database.'],
 '25006':['database_read_only','DATABASE_URL points to a read-only database connection. Use the primary writable database.'],
 ENOTFOUND:['database_hostname_unresolved','The database hostname could not be resolved. Verify the Internal Database URL and that the Cron Job and Postgres service are in the same Render region and network.'],
 EAI_AGAIN:['database_dns_temporary','Database DNS resolution failed temporarily. Retry; check the service region and database hostname if it persists.'],
 ECONNREFUSED:['database_connection_refused','The database refused the connection. Verify the database is running and DATABASE_URL has its current host and port.'],
 ENETUNREACH:['database_network_unreachable','The database network is unreachable. Verify the services are in the same Render region/network, or use the database external TLS URL when appropriate.'],
 EHOSTUNREACH:['database_network_unreachable','The database host is unreachable. Check the database service and Render networking.'],
 ETIMEDOUT:['database_connection_timeout','The database connection timed out. Check that Postgres is available and the worker can reach its connection URL.'],
 ECONNRESET:['database_connection_reset','The database connection was reset. Retry and check database availability.'],
 '53300':['database_connection_limit','PostgreSQL has reached its connection limit. Check existing connections and the database plan.'],
 '57P03':['database_not_ready','PostgreSQL is starting, recovering, or temporarily unavailable. Wait for it to become available and retry.'],
 '53100':['database_disk_full','The PostgreSQL service reports that its disk is full. Check its storage usage.'],
 '42601':['database_schema_syntax','PostgreSQL rejected application SQL syntax. Share this diagnostic code and stage so the app query can be corrected.'],
 '42883':['database_function_missing','A PostgreSQL function required by the scheduler is unavailable. Verify this is a supported PostgreSQL database.'],
 '42P01':['database_table_missing','A scheduling database table is missing. Check database initialization permissions and the deployed application version.'],
 '42703':['database_column_missing','The database schema is missing a scheduling column. Check the deployed version and database migration permissions.'],
 SELF_SIGNED_CERT_IN_CHAIN:['database_tls_certificate','Database TLS certificate verification failed. Use the correct provider connection URL and trusted CA configuration; keep certificate verification enabled.'],
 DEPTH_ZERO_SELF_SIGNED_CERT:['database_tls_certificate','Database TLS certificate verification failed. Check the provider URL and trusted CA configuration.'],
 UNABLE_TO_VERIFY_LEAF_SIGNATURE:['database_tls_certificate','The database TLS certificate could not be verified. Check the provider CA configuration.'],
 ERR_TLS_CERT_ALTNAME_INVALID:['database_tls_hostname','The database TLS certificate does not match the hostname. Use the exact hostname from the provider connection URL.'],
 CERT_HAS_EXPIRED:['database_tls_expired','The database TLS certificate has expired. Check with the database provider.'],
};
const stages=new Set(['configuration','database_init','database_connect','claim','run','save_result','tick']);
function findKnown(error,seen=new Set()){
 if(!error||typeof error!=='object'||seen.has(error)||seen.size>12)return null;seen.add(error);
 if(Object.hasOwn(known,error.code))return error;
 const cause=findKnown(error.cause,seen);if(cause)return cause;
 for(const item of Array.isArray(error.errors)?error.errors:[]){const found=findKnown(item,seen);if(found)return found;}
 return null;
}
export function schedulerDiagnostic(error){
 const stage=stages.has(error?.scheduleStage)?error.scheduleStage:'tick';
 if(typeof error?.schedulePublic==='string'&&error.schedulePublic.startsWith('The scheduling encryption key does not match'))return {code:'encryption_key_mismatch',stage,message:'SCHEDULE_ENCRYPTION_KEY does not match the key already bound to this database. Copy the original value from Agent to the Cron Job. Do not generate a new key or reset the database.'};
 const matched=findKnown(error);if(matched){const [code,message]=known[matched.code];return {code,stage,driverCode:matched.code,...(matched.code==='42601'&&/^\d{1,6}$/.test(String(matched.position))?{position:Number(matched.position)}:{}),message};}
 if(/connection.*(?:timed? ?out|timeout)|timeout.*connect/i.test(error?.message||''))return {code:'database_connection_timeout',stage,message:'The database connection timed out. Verify the database is running and the worker can reach its URL.'};
 if(/password must be a string|client password must be a string/i.test(error?.message||''))return {code:'database_password_missing',stage,message:'DATABASE_URL does not provide a usable database password. Copy the complete Internal Database URL, not the PSQL Command.'};
 return {code:'scheduler_unclassified',stage,message:'The scheduler stopped for an unclassified application or database error. Share this diagnostic code and stage; no credential values are included.'};
}
export function databaseConnectionString(value){
 const connection=typeof value==='string'?value.trim():'';let valid=false;
 try{const url=new URL(connection);valid=['postgres:','postgresql:'].includes(url.protocol)&&Boolean(url.hostname)&&url.pathname.length>1;}catch{}
 if(!valid){const error=Error('Invalid PostgreSQL connection URL');error.code='SCHEDULE_DATABASE_URL';error.scheduleStage='configuration';error.schedulePublic=known.SCHEDULE_DATABASE_URL[1];throw error;}return connection;
}
export function logSchedulerFailure(error,logger=console.error){const diagnostic=schedulerDiagnostic(error);logger('Scheduler tick failed: '+JSON.stringify(diagnostic));return diagnostic;}
