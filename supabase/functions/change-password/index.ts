// Edge Function: change-password — see ../_shared/handlers.ts
import { createClient } from 'npm:@supabase/supabase-js@2.109.0';
import { HANDLERS } from '../_shared/handlers.ts';

Deno.serve(HANDLERS['change-password']({ env: (name: string) => Deno.env.get(name), createClient }));
