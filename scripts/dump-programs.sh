#!/usr/bin/env bash
# Downloads the program binaries the end-to-end test runs against (needs the Solana CLI).
# The programmatic-signer programs come from devnet; Lighthouse from mainnet (same id on devnet).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p programs/fixtures
solana program dump -u devnet EdSigVfK1DkeMrjFNDMjwfQaJPhPTtX7jW8uPv3oKEgN programs/fixtures/spl_ed25519_signer_program.so
solana program dump -u devnet ExecxgyHYsAXB4c5dZodV1zJZ9hqfsDCYkRDRATrpkFR programs/fixtures/spl_message_executor_program.so
solana program dump -u devnet Noncediea1fH12usShuQAz28UhgAeuE5Maf32LsMUQB programs/fixtures/spl_nonce_program.so
solana program dump -u mainnet-beta L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95 programs/fixtures/lighthouse.so
echo "Done. Run: npm test"
