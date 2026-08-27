import { createClient } from '@supabase/supabase-js';

const supabaseUrl = "https://ddpgpviqsmhzpadfmjji.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkcGdwdmlxc21oenBhZGZtamppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2ODgyNjQsImV4cCI6MjEwMzI2NDI2NH0.RWB5KvjauGighSPO8M_5kfYFxWE-6vvimKDM_vq7qcU";
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase
    .from('players')
    .select('id, name, push_subscription')
    .not('push_subscription', 'is', null);

  if (error) {
    console.error("Query Error:", error);
  } else {
    console.log("Players with subscriptions:", JSON.stringify(data, null, 2));
  }
}

run();
