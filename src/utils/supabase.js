import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import 'react-native-url-polyfill/auto'; // must stay the first import

// Replace with your values: Supabase dashboard > Project Settings > API
const SUPABASE_URL = 'https://vlgfeqgbldoxjmcaydhg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZsZ2ZlcWdibGRveGptY2F5ZGhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1NjEwNzAsImV4cCI6MjEwNzEzNzA3MH0.y-8-FXj5seYqvraN2PFfn9uSCLB8F9K4FUWyNB_g7tU';

// On web, Expo Router first renders pages in Node (no "window"), where AsyncStorage crashes.
// There we skip storage; in the real app (phone or browser) it is used as normal.
const isServer = typeof window === 'undefined';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: isServer ? undefined : AsyncStorage, // keeps the login session on the device
    autoRefreshToken: !isServer,
    persistSession: !isServer,
    detectSessionInUrl: false, // not needed in a React Native app
  },
});

// Only refresh the session token while the app is in the foreground
if (!isServer) {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}