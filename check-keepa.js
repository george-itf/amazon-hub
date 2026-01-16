/**
 * Keepa API Diagnostic Script
 * Checks configuration and tests API connectivity
 */

import dotenv from 'dotenv';

dotenv.config();

const API_KEY = process.env.KEEPA_API_KEY;
const KEEPA_API_BASE = 'https://api.keepa.com';

console.log('='.repeat(60));
console.log('KEEPA API DIAGNOSTIC');
console.log('='.repeat(60));

// Check 1: API Key Configuration
console.log('\n1. API Key Configuration:');
if (!API_KEY) {
  console.log('   ❌ KEEPA_API_KEY is NOT set');
  console.log('   → Please set KEEPA_API_KEY environment variable');
  console.log('   → Check Railway dashboard: Settings > Variables');
  process.exit(1);
} else {
  console.log('   ✅ KEEPA_API_KEY is set');
  console.log(`   → Key length: ${API_KEY.length} characters`);
  console.log(`   → First 4 chars: ${API_KEY.substring(0, 4)}...`);
}

// Check 2: Test API Connectivity
console.log('\n2. Testing API Connectivity:');
try {
  // Test with a simple request (using minimal token)
  const testAsin = 'B07ZPKN6YR'; // Example ASIN
  const url = `${KEEPA_API_BASE}/product?key=${API_KEY}&domain=2&asin=${testAsin}&stats=90`;

  console.log(`   → Making test request to Keepa API...`);
  console.log(`   → Testing ASIN: ${testAsin}`);

  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok) {
    console.log(`   ❌ API Request Failed: ${response.status}`);
    console.log(`   → Error: ${JSON.stringify(data, null, 2)}`);

    if (data.error === 'ACCESS_DENIED') {
      console.log('\n   Possible causes:');
      console.log('   1. Invalid API key');
      console.log('   2. API key not activated');
      console.log('   3. Account suspended');
    }
    process.exit(1);
  }

  console.log('   ✅ API Request Successful');
  console.log(`   → Tokens Left: ${data.tokensLeft || 'N/A'}`);
  console.log(`   → Refill Rate: ${data.refillRate || 'N/A'} tokens/min`);
  console.log(`   → Refill In: ${data.refillIn ? (data.refillIn / 60000).toFixed(1) + ' min' : 'N/A'}`);
  console.log(`   → Products Returned: ${data.products?.length || 0}`);

  if (data.products && data.products.length > 0) {
    const product = data.products[0];
    console.log(`   → Product Title: ${product.title || 'N/A'}`);
    console.log(`   → Has CSV Data: ${product.csv ? 'Yes' : 'No'}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ ALL CHECKS PASSED - Keepa API is working correctly');
  console.log('='.repeat(60));

  // Check 3: Budget Status
  if (data.tokensLeft !== undefined) {
    console.log('\n3. Budget Status:');
    console.log(`   Tokens Available: ${data.tokensLeft}`);
    if (data.tokensLeft < 100) {
      console.log('   ⚠️  WARNING: Low token balance');
    } else if (data.tokensLeft < 500) {
      console.log('   ⚠️  CAUTION: Moderate token balance');
    } else {
      console.log('   ✅ Token balance is healthy');
    }
  }

} catch (error) {
  console.log(`   ❌ Error: ${error.message}`);
  console.log('\n   Possible causes:');
  console.log('   1. Network connectivity issues');
  console.log('   2. Keepa API is down');
  console.log('   3. Invalid API endpoint');
  console.error('\n   Full error:', error);
  process.exit(1);
}
