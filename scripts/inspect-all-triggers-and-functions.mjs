import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://knowletive:knowletive@127.0.0.1:5432/knowletive_final_rehearsal_20261121_184300?schema=public'
    }
  }
});

async function main() {
  console.log('Querying all public functions and triggers in rehearsal DB...\n');

  // 1. Get all public functions
  const functions = await prisma.$queryRawUnsafe(`
    SELECT 
      p.proname as function_name,
      pg_get_function_identity_arguments(p.oid) as arguments,
      pg_get_functiondef(p.oid) as definition,
      p.prosecdef as security_definer,
      p.provolatile as volatility,
      r.rolname as owner,
      d.description
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_roles r ON r.oid = p.proowner
    LEFT JOIN pg_description d ON d.objoid = p.oid
    WHERE n.nspname = 'public'
    ORDER BY p.proname;
  `);

  console.log(`Total public functions found: ${functions.length}`);

  // 2. Get all triggers and their attached functions
  const triggers = await prisma.$queryRawUnsafe(`
    SELECT 
      t.tgname as trigger_name,
      c.relname as table_name,
      p.proname as function_name,
      CASE t.tgtype & 2
        WHEN 2 THEN 'BEFORE'
        ELSE 'AFTER'
      END as timing,
      CASE t.tgtype & 28
        WHEN 4 THEN 'INSERT'
        WHEN 8 THEN 'DELETE'
        WHEN 12 THEN 'INSERT OR DELETE'
        WHEN 16 THEN 'UPDATE'
        WHEN 20 THEN 'INSERT OR UPDATE'
        WHEN 24 THEN 'UPDATE OR DELETE'
        WHEN 28 THEN 'INSERT OR UPDATE OR DELETE'
        ELSE 'OTHER'
      END as events,
      t.tgenabled as status,
      t.tgisinternal as is_internal
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE n.nspname = 'public' AND NOT t.tgisinternal
    ORDER BY c.relname, t.tgname;
  `);

  console.log(`Total user triggers found: ${triggers.length}\n`);

  // Map triggers to functions
  const funcMap = {};
  functions.forEach(f => {
    funcMap[f.function_name] = {
      ...f,
      triggers: []
    };
  });

  triggers.forEach(t => {
    if (funcMap[t.function_name]) {
      funcMap[t.function_name].triggers.push({
        trigger: t.trigger_name,
        table: t.table_name,
        timing: t.timing,
        events: t.events
      });
    } else {
      console.warn(`Trigger ${t.trigger_name} attaches to unmapped function ${t.function_name}`);
    }
  });

  const detailedList = Object.values(funcMap).map((f, idx) => ({
    index: idx + 1,
    name: f.function_name,
    arguments: f.arguments,
    secDef: f.security_definer,
    volatility: f.volatility,
    owner: f.owner,
    triggersCount: f.triggers.length,
    triggers: f.triggers
  }));

  console.table(detailedList.map(f => ({
    '#': f.index,
    Function: f.name,
    SecDef: f.secDef,
    Volatility: f.volatility,
    Triggers: f.triggersCount,
    Tables: [...new Set(f.triggers.map(t => t.table))].join(', ')
  })));

  // Write full details and definitions to a json for detailed analysis
  import('fs').then(fs => {
    fs.writeFileSync('scripts/rehearsal_functions_inventory.json', JSON.stringify(funcMap, null, 2));
    console.log('\nWrote full function inventory to scripts/rehearsal_functions_inventory.json');
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
