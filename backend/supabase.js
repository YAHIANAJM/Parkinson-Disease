const { createClient } = require('@supabase/supabase-js')

const supabaseUrl     = process.env.SUPABASE_URL
const supabaseKey     = process.env.SUPABASE_SERVICE_KEY   // service role — bypasses RLS for backend

if (!supabaseUrl || !supabaseKey) {
  console.error('[supabase] SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
})

module.exports = supabase
