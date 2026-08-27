import { createClient } from '@supabase/supabase-js';

const supabaseUrl = "https://ddpgpviqsmhzpadfmjji.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkcGdwdmlxc21oenBhZGZtamppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2ODgyNjQsImV4cCI6MjEwMzI2NDI2NH0.RWB5KvjauGighSPO8M_5kfYFxWE-6vvimKDM_vq7qcU";
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase
    .from('players')
    .update({ status: 'REGISTERED' })
    .eq('id', 'aea07bf2-f0da-4a46-ae40-967253173e7f')
    .select();

  if (error) {
    console.error("Update Error:", error);
  } else {
    console.log("Update Success. Rows affected:", data.length);
  }
}

run();
