import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  allowAllModules,
  StellarWalletsKit,
  WalletNetwork,
} from '@creit.tech/stellar-wallets-kit';
import {
  Address,
  Asset,
  BASE_FEE,
  Contract,
  rpc,
  ScInt,
  scValToNative,
  Transaction,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock3,
  Coins,
  ExternalLink,
  Gavel,
  Loader2,
  Radio,
  Wallet,
} from 'lucide-react';
import heroAsset from './assets/hero.png';

const SERVER_URL =
  import.meta.env.VITE_SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
const DEFAULT_CONTRACT_ID =
  'CBJE2A4DFK7ZI3KPD2BHYPURDXKYP7XNUIVBM6DLWIXSNOTKC37KZQTO';
const CONTRACT_ID =
  import.meta.env.VITE_AUCTION_CONTRACT_ID || DEFAULT_CONTRACT_ID;
const XLM_CONTRACT_ID = Asset.native().contractId(NETWORK_PASSPHRASE);
const STROOPS_PER_XLM = 10_000_000n;
const BID_TOPIC = xdr.ScVal.scvSymbol('bid').toXDR('base64');

const kit = new StellarWalletsKit({
  network: WalletNetwork.TESTNET,
  selectedWalletId: 'freighter',
  modules: allowAllModules(),
});

const isContractConfigured =
  /^C[A-Z2-7]{55}$/.test(CONTRACT_ID);

const initialAuction = {
  highestBid: 100n * STROOPS_PER_XLM,
  highestBidder: '',
  isActive: true,
  itemName: 'Rare Digital Artifact #042',
};

function shorten(value = '') {
  if (!value || value.length < 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function formatXlm(stroops) {
  const value = BigInt(stroops || 0);
  const whole = value / STROOPS_PER_XLM;
  const decimal = (value % STROOPS_PER_XLM).toString().padStart(7, '0');
  const trimmed = decimal.replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole.toString();
}

function parseXlmToStroops(value) {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,7})?$/.test(trimmed)) {
    throw new Error('Enter a valid XLM amount with up to 7 decimals.');
  }

  const [whole, decimal = ''] = trimmed.split('.');
  return BigInt(whole) * STROOPS_PER_XLM + BigInt(decimal.padEnd(7, '0'));
}

function normalizeError(error) {
  const message = String(error?.message || error?.error || error || '').toLowerCase();

  if (
    message.includes('not found') ||
    message.includes('not installed') ||
    message.includes('not available') ||
    message.includes('wallet id')
  ) {
    return 'Wallet not found. Install or unlock a Stellar testnet wallet, then try again.';
  }

  if (
    message.includes('rejected') ||
    message.includes('declined') ||
    message.includes('denied') ||
    message.includes('cancel')
  ) {
    return 'Wallet request rejected. No transaction was submitted.';
  }

  if (
    message.includes('insufficient') ||
    message.includes('underfunded') ||
    message.includes('balance')
  ) {
    return 'Insufficient balance for the bid amount or network fees.';
  }

  return error?.message || 'Unexpected wallet or network error.';
}

function eventToBid(event) {
  const bidder = event.topic?.[1] ? String(scValToNative(event.topic[1])) : '';
  const amount = event.value ? BigInt(scValToNative(event.value)) : 0n;

  return {
    id: event.id || `${event.txHash}-${event.ledger}`,
    amount,
    bidder,
    ledger: event.ledger,
    txHash: event.txHash,
    closedAt: event.ledgerClosedAt,
  };
}

function App() {
  const server = useMemo(() => new rpc.Server(SERVER_URL), []);
  const contract = useMemo(() => new Contract(CONTRACT_ID), []);

  const [address, setAddress] = useState('');
  const [selectedWallet, setSelectedWallet] = useState('');
  const [wallets, setWallets] = useState([]);
  const [auction, setAuction] = useState(initialAuction);
  const [bidAmount, setBidAmount] = useState('');
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState({
    type: isContractConfigured ? 'idle' : 'error',
    message: isContractConfigured
      ? 'Connect a testnet wallet to load on-chain auction state.'
      : 'Set VITE_AUCTION_CONTRACT_ID to your deployed testnet contract address.',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    let mounted = true;

    kit.getSupportedWallets().then((supportedWallets) => {
      if (mounted) setWallets(supportedWallets);
    });

    return () => {
      mounted = false;
    };
  }, []);

  const simulateContractCall = useCallback(
    async (method, args = []) => {
      if (!address) return null;

      const account = await server.getAccount(address);
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(contract.call(method, ...args))
        .setTimeout(30)
        .build();

      const simulated = await server.simulateTransaction(tx);
      if (simulated.error) throw new Error(simulated.error);
      return simulated.result?.retval ? scValToNative(simulated.result.retval) : null;
    },
    [address, contract, server],
  );

  const syncEvents = useCallback(async () => {
    if (!isContractConfigured) return;

    try {
      const latest = await server.getLatestLedger();
      const startLedger = Math.max(1, latest.sequence - 1200);
      const response = await server.getEvents({
        startLedger,
        limit: 10,
        filters: [
          {
            type: 'contract',
            contractIds: [CONTRACT_ID],
            topics: [[BID_TOPIC, '*']],
          },
        ],
      });

      setEvents(response.events.map(eventToBid).reverse());
    } catch (error) {
      console.warn('Event sync failed', error);
    }
  }, [server]);

  const refreshAuction = useCallback(async () => {
    if (!isContractConfigured || !address) return;

    setIsSyncing(true);
    try {
      const [highestBid, highestBidder, isActive, itemName] = await Promise.all([
        simulateContractCall('get_highest_bid'),
        simulateContractCall('get_highest_bidder'),
        simulateContractCall('is_active'),
        simulateContractCall('get_item_name'),
      ]);

      setAuction({
        highestBid: BigInt(highestBid || 0),
        highestBidder: highestBidder ? String(highestBidder) : '',
        isActive: Boolean(isActive),
        itemName: itemName ? String(itemName) : initialAuction.itemName,
      });
      await syncEvents();
      setStatus({
        type: 'success',
        message: 'On-chain auction state synchronized.',
      });
    } catch (error) {
      setStatus({
        type: 'error',
        message: `Could not read contract state: ${normalizeError(error)}`,
      });
    } finally {
      setIsSyncing(false);
    }
  }, [address, simulateContractCall, syncEvents]);

  useEffect(() => {
    refreshAuction();
  }, [refreshAuction]);

  useEffect(() => {
    if (!isContractConfigured) return undefined;

    syncEvents();
    const interval = window.setInterval(syncEvents, 8000);
    return () => window.clearInterval(interval);
  }, [syncEvents]);

  const connectWallet = async () => {
    try {
      setStatus({ type: 'pending', message: 'Opening Stellar wallet selector...' });
      await kit.openModal({
        modalTitle: 'Connect a Stellar testnet wallet',
        notAvailableText: 'Wallet not found',
        onWalletSelected: async (option) => {
          kit.setWallet(option.id);
          const response = await kit.getAddress();
          setAddress(response.address);
          setSelectedWallet(option.name);
          setStatus({
            type: 'success',
            message: `Connected ${option.name}: ${shorten(response.address)}`,
          });
        },
        onClosed: () => {
          setStatus({ type: 'error', message: 'Wallet connection rejected by user.' });
        },
      });
    } catch (error) {
      setStatus({ type: 'error', message: normalizeError(error) });
    }
  };

  const pollTransaction = async (hash) => {
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const response = await server.getTransaction(hash);

      if (response.status === 'SUCCESS') return response;
      if (response.status === 'FAILED') {
        throw new Error('Transaction failed on-chain. Check the explorer for details.');
      }

      await delay(2500);
    }

    throw new Error('Transaction is still pending after 60 seconds.');
  };

  const placeBid = async () => {
    if (!isContractConfigured) {
      setStatus({
        type: 'error',
        message: 'Deploy the contract and set VITE_AUCTION_CONTRACT_ID before bidding.',
      });
      return;
    }

    if (!address) {
      setStatus({ type: 'error', message: 'Please connect a wallet before bidding.' });
      return;
    }

    let bidStroops;
    try {
      bidStroops = parseXlmToStroops(bidAmount);
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
      return;
    }

    if (bidStroops <= auction.highestBid) {
      setStatus({
        type: 'error',
        message: 'Bid must be higher than the current highest bid.',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      setStatus({ type: 'pending', message: 'Preparing contract call...' });

      const account = await server.getAccount(address);
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(
          contract.call(
            'bid',
            new Address(address).toScVal(),
            new ScInt(bidStroops).toI128(),
          ),
        )
        .setTimeout(30)
        .build();

      const preparedTx = await server.prepareTransaction(tx);
      setStatus({ type: 'pending', message: 'Waiting for wallet approval...' });

      const { signedTxXdr } = await kit.signTransaction(preparedTx.toXDR(), {
        address,
        networkPassphrase: NETWORK_PASSPHRASE,
      });
      const signedTx = new Transaction(signedTxXdr, NETWORK_PASSPHRASE);

      setStatus({ type: 'pending', message: 'Submitting transaction to testnet...' });
      const submitted = await server.sendTransaction(signedTx);

      if (submitted.status === 'ERROR') {
        throw new Error('RPC rejected the transaction before it reached the ledger.');
      }

      setStatus({
        type: 'pending',
        hash: submitted.hash,
        message: `Transaction pending: ${shorten(submitted.hash)}`,
      });

      await pollTransaction(submitted.hash);
      setAuction((current) => ({
        ...current,
        highestBid: bidStroops,
        highestBidder: address,
      }));
      setBidAmount('');
      setStatus({
        type: 'success',
        hash: submitted.hash,
        message: `Bid confirmed: ${formatXlm(bidStroops)} XLM`,
      });
      await refreshAuction();
    } catch (error) {
      setStatus({ type: 'error', message: normalizeError(error) });
    } finally {
      setIsSubmitting(false);
    }
  };

  const explorerUrl = status.hash
    ? `https://stellar.expert/explorer/testnet/tx/${status.hash}`
    : '';
  const minimumBid = auction.highestBid + 1n;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-950/95">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500 text-zinc-950">
              <Gavel className="h-5 w-5" />
            </div>
            <div>
              <p className="text-lg font-semibold leading-tight">NexusAuction</p>
              <p className="text-xs text-zinc-400">Soroban testnet live bidding</p>
            </div>
          </div>

          <button
            type="button"
            onClick={connectWallet}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-100 transition hover:border-emerald-400 hover:text-emerald-200"
          >
            <Wallet className="h-4 w-4" />
            {address ? shorten(address) : 'Connect'}
          </button>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className="grid gap-6">
          <div className="grid overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="p-6 sm:p-8">
              <div className="mb-5 inline-flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-sm font-medium text-emerald-200">
                <Radio className="h-4 w-4" />
                {auction.isActive ? 'Live auction' : 'Auction ended'}
              </div>
              <h1 className="max-w-3xl text-4xl font-bold tracking-normal text-white sm:text-5xl">
                {auction.itemName}
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-400">
                Mintable NFT auction with multi-wallet connection, signed contract
                calls, visible transaction status, and event-driven bid updates.
              </p>

              <div className="mt-8 grid gap-4 sm:grid-cols-3">
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                  <p className="text-sm text-zinc-500">Highest bid</p>
                  <p className="mt-2 text-3xl font-semibold text-emerald-300">
                    {formatXlm(auction.highestBid)}
                  </p>
                  <p className="text-sm text-zinc-500">XLM</p>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                  <p className="text-sm text-zinc-500">Highest bidder</p>
                  <p className="mt-3 text-lg font-semibold text-zinc-100">
                    {auction.highestBidder ? shorten(auction.highestBidder) : 'No bids yet'}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                  <p className="text-sm text-zinc-500">Contract</p>
                  <p className="mt-3 break-all text-sm font-medium text-zinc-200">
                    {isContractConfigured ? shorten(CONTRACT_ID) : 'Not configured'}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-center border-t border-zinc-800 bg-zinc-950 p-8 lg:border-l lg:border-t-0">
              <img
                src={heroAsset}
                alt="Layered digital auction artifact"
                className="h-auto max-h-72 w-full max-w-72 object-contain"
              />
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">Wallet Options</h2>
                  <p className="text-sm text-zinc-500">Use this panel for the required screenshot.</p>
                </div>
                <Wallet className="h-5 w-5 text-emerald-300" />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {wallets.map((wallet) => (
                  <div
                    key={wallet.id}
                    className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <img src={wallet.icon} alt="" className="h-6 w-6 rounded" />
                      <span className="truncate text-sm font-medium">{wallet.name}</span>
                    </div>
                    <span
                      className={`rounded-md px-2 py-1 text-xs ${
                        wallet.isAvailable
                          ? 'bg-emerald-500/10 text-emerald-300'
                          : 'bg-zinc-800 text-zinc-400'
                      }`}
                    >
                      {wallet.isAvailable ? 'Ready' : 'Install'}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">Live Events</h2>
                  <p className="text-sm text-zinc-500">Pulled from Soroban RPC every 8 seconds.</p>
                </div>
                {isSyncing ? (
                  <Loader2 className="h-5 w-5 animate-spin text-sky-300" />
                ) : (
                  <Activity className="h-5 w-5 text-sky-300" />
                )}
              </div>
              <div className="space-y-2">
                {events.length === 0 ? (
                  <p className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-4 text-sm text-zinc-500">
                    No bid events loaded yet.
                  </p>
                ) : (
                  events.map((event) => (
                    <div
                      key={event.id}
                      className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-medium">Bid placed</p>
                        <p className="text-xs text-zinc-500">
                          {shorten(event.bidder)} at ledger {event.ledger}
                        </p>
                      </div>
                      <p className="text-sm font-semibold text-emerald-300">
                        {formatXlm(event.amount)} XLM
                      </p>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </section>

        <aside className="h-fit rounded-lg border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="text-xl font-semibold">Place a Bid</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Connected wallet: {address ? `${selectedWallet} ${shorten(address)}` : 'None'}
          </p>

          <label htmlFor="bid-amount" className="mt-6 block text-sm font-medium text-zinc-300">
            Bid amount
          </label>
          <div className="mt-2 flex rounded-lg border border-zinc-700 bg-zinc-950 focus-within:border-emerald-400">
            <input
              id="bid-amount"
              type="text"
              inputMode="decimal"
              value={bidAmount}
              onChange={(event) => setBidAmount(event.target.value)}
              placeholder={`Min ${formatXlm(minimumBid)}`}
              className="min-w-0 flex-1 bg-transparent px-4 py-3 text-base outline-none placeholder:text-zinc-600"
            />
            <span className="flex items-center border-l border-zinc-800 px-4 text-sm font-semibold text-zinc-400">
              XLM
            </span>
          </div>

          <button
            type="button"
            onClick={placeBid}
            disabled={isSubmitting}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-400 px-4 py-3 font-semibold text-zinc-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
          >
            {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Coins className="h-5 w-5" />}
            {isSubmitting ? 'Processing' : 'Submit Contract Bid'}
          </button>

          <div
            className={`mt-5 rounded-lg border p-4 ${
              status.type === 'error'
                ? 'border-red-500/30 bg-red-500/10 text-red-200'
                : status.type === 'success'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                  : status.type === 'pending'
                    ? 'border-sky-500/30 bg-sky-500/10 text-sky-200'
                    : 'border-zinc-800 bg-zinc-950 text-zinc-400'
            }`}
          >
            <div className="flex items-start gap-3">
              {status.type === 'error' && <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />}
              {status.type === 'success' && <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />}
              {status.type === 'pending' && <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin" />}
              {status.type === 'idle' && <Clock3 className="mt-0.5 h-5 w-5 shrink-0" />}
              <div>
                <p className="text-sm font-medium">{status.message}</p>
                {explorerUrl && (
                  <a
                    href={explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-sm underline decoration-current underline-offset-4"
                  >
                    View transaction <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            </div>
          </div>

          <dl className="mt-5 grid gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm">
            <div>
              <dt className="text-zinc-500">RPC</dt>
              <dd className="break-all text-zinc-300">{SERVER_URL}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">XLM token contract</dt>
              <dd className="break-all text-zinc-300">{shorten(XLM_CONTRACT_ID)}</dd>
            </div>
          </dl>
        </aside>
      </main>
    </div>
  );
}

export default App;
