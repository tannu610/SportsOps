import { createClient } from '@supabase/supabase-js';

const supabaseUrl = "https://ddpgpviqsmhzpadfmjji.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkcGdwdmlxc21oenBhZGZtamppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2ODgyNjQsImV4cCI6MjEwMzI2NDI2NH0.RWB5KvjauGighSPO8M_5kfYFxWE-6vvimKDM_vq7qcU";
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase
    .from('matches')
    .select(`
      id,
      team1_p1:players!fk_t1p1(id, push_subscription),
      team1_p2:players!fk_t1p2(id, push_subscription),
      team2_p1:players!fk_t2p1(id, push_subscription),
      team2_p2:players!fk_t2p2(id, push_subscription)
    `)
    .limit(1);

  if (error) {
    console.error("Query Error fk_t1p1:", error);
  } else {
    console.log("Query Success fk_t1p1:", JSON.stringify(data, null, 2));
  }
}

run();
