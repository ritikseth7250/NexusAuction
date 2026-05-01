import { existsSync, readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import {
  Address,
  Asset,
  BASE_FEE,
  Contract,
  hash,
  Keypair,
  nativeToScVal,
  Operation,
  rpc,
  ScInt,
  StrKey,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';

const RPC_URL = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
const WASM_PATH = resolve(
  process.cwd(),
  '..',
  'contract',
  'target',
  'wasm32v1-none',
  'release',
  'auction.wasm',
);
const ITEM_NAME = process.env.AUCTION_ITEM_NAME || 'Rare Digital Artifact #042';
const MIN_BID_STROOPS = BigInt(process.env.AUCTION_MIN_BID_STROOPS || '1000000000');
const XLM_CONTRACT_ID = Asset.native().contractId(NETWORK_PASSPHRASE);
const server = new rpc.Server(RPC_URL);

function contractIdFromPreimage(deployerAddress, salt) {
  const preimage = xdr.ContractIdPreimage.contractIdPreimageFromAddress(
    new xdr.ContractIdPreimageFromAddress({
      address: deployerAddress.toScAddress(),
      salt,
    }),
  );
  const contractHash = hash(
    xdr.HashIdPreimage.envelopeTypeContractId(
      new xdr.HashIdPreimageContractId({
        networkId: hash(Buffer.from(NETWORK_PASSPHRASE)),
        contractIdPreimage: preimage,
      }),
    ).toXDR(),
  );

  return StrKey.encodeContract(contractHash);
}

async function pollTransaction(hashToPoll) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const transaction = await server.getTransaction(hashToPoll);

    if (transaction.status === 'SUCCESS') return transaction;
    if (transaction.status === 'FAILED') {
      throw new Error(`Transaction failed: ${hashToPoll}`);
    }

    await new Promise((resolveDelay) => {
      setTimeout(resolveDelay, 2000);
    });
  }

  throw new Error(`Timed out waiting for ${hashToPoll}`);
}

async function submitOperation(source, operation, label) {
  const account = await server.getAccount(source.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: (Number(BASE_FEE) * 100_000).toString(),
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(operation)
    .setTimeout(300)
    .build();
  const prepared = await server.prepareTransaction(tx);
  prepared.sign(source);
  const submitted = await server.sendTransaction(prepared);

  if (submitted.status === 'ERROR') {
    throw new Error(`${label} was rejected by RPC before ledger submission.`);
  }

  await pollTransaction(submitted.hash);
  console.log(`${label} tx: ${submitted.hash}`);
  return submitted.hash;
}

async function fundGeneratedAccount(publicKey) {
  const network = await server.getNetwork();
  const friendbotUrl = network.friendbotUrl || 'https://friendbot.stellar.org';
  const response = await fetch(`${friendbotUrl}?addr=${encodeURIComponent(publicKey)}`);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Friendbot failed with ${response.status}: ${body}`);
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await server.getAccount(publicKey);
      return;
    } catch {
      await new Promise((resolveDelay) => {
        setTimeout(resolveDelay, 1000);
      });
    }
  }

  throw new Error(`Friendbot funded ${publicKey}, but the account was not readable yet.`);
}

async function main() {
  if (!existsSync(WASM_PATH)) {
    throw new Error(
      `Missing WASM at ${WASM_PATH}. Run: cargo build --target wasm32v1-none --release --manifest-path ../contract/Cargo.toml`,
    );
  }

  const source = process.env.DEPLOYER_SECRET_KEY
    ? Keypair.fromSecret(process.env.DEPLOYER_SECRET_KEY)
    : Keypair.random();

  if (!process.env.DEPLOYER_SECRET_KEY) {
    console.log(`Generated testnet deployer: ${source.publicKey()}`);
    console.log(`Generated testnet secret: ${source.secret()}`);
    await fundGeneratedAccount(source.publicKey());
  }

  const wasm = readFileSync(WASM_PATH);
  const wasmHash = createHash('sha256').update(wasm).digest();
  const salt = randomBytes(32);
  const deployerAddress = new Address(source.publicKey());
  const contractId = contractIdFromPreimage(deployerAddress, salt);
  const contract = new Contract(contractId);

  const uploadTx = await submitOperation(
    source,
    Operation.uploadContractWasm({ wasm }),
    'Upload WASM',
  );
  const createTx = await submitOperation(
    source,
    Operation.createCustomContract({
      address: deployerAddress,
      wasmHash,
      salt,
    }),
    'Create contract',
  );
  const initTx = await submitOperation(
    source,
    contract.call(
      'init',
      new Address(source.publicKey()).toScVal(),
      nativeToScVal(ITEM_NAME),
      new Address(XLM_CONTRACT_ID).toScVal(),
      new ScInt(MIN_BID_STROOPS).toI128(),
    ),
    'Initialize auction',
  );

  console.log('');
  console.log('Deployment complete');
  console.log(`Contract ID: ${contractId}`);
  console.log(`XLM token contract: ${XLM_CONTRACT_ID}`);
  console.log(`Contract call tx hash: ${initTx}`);
  console.log(`Explorer: https://stellar.expert/explorer/testnet/contract/${contractId}`);
  console.log('');
  console.log('Add this to frontend/.env.local:');
  console.log(`VITE_AUCTION_CONTRACT_ID=${contractId}`);
  console.log('');
  console.log('README values:');
  console.log(`- Upload WASM tx: ${uploadTx}`);
  console.log(`- Create contract tx: ${createTx}`);
  console.log(`- Contract call tx: ${initTx}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
