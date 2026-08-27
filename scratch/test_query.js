import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase
    .from('matches')
    .select(`
      id,
      team1_p1:players!team1_p1_id(id, push_subscription),
      team1_p2:players!team1_p2_id(id, push_subscription),
      team2_p1:players!team2_p1_id(id, push_subscription),
      team2_p2:players!team2_p2_id(id, push_subscription)
    `)
    .limit(1);

  if (error) {
    console.error("Query Error:", error);
  } else {
    console.log("Query Success:", JSON.stringify(data, null, 2));
  }
}

run();
