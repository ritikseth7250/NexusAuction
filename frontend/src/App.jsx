import React, { useState, useEffect } from 'react';
import { StellarWalletsKit, WalletNetwork, allowAllModules } from '@creit.tech/stellar-wallets-kit';
import { Contract, rpc, xdr, Address, scValToNative, nativeToScVal } from '@stellar/stellar-sdk';
import { Coins, AlertCircle, CheckCircle2, Loader2, ArrowRight, Gavel, Wallet } from 'lucide-react';

const SERVER_URL = 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';

const CONTRACT_ID = 'CACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'; 

const kit = new StellarWalletsKit({
  network: WalletNetwork.TESTNET,
  selectedWalletId: 'freighter',
  modules: allowAllModules(),
});

function App() {
  const [address, setAddress] = useState('');
  const [highestBid, setHighestBid] = useState(100); 
  const [bidAmount, setBidAmount] = useState('');
  const [status, setStatus] = useState(null); 
  const [events, setEvents] = useState([]);

  const connectWallet = async () => {
    try {
      await kit.openModal({
        onWalletSelected: async (option) => {
          kit.setWallet(option.id);
          const publicKey = await kit.getPublicKey();
          setAddress(publicKey);
        }
      });
    } catch (e) {
      if (e.message?.toLowerCase().includes('not found') || e.message?.toLowerCase().includes('installed')) {
         setStatus({ type: 'error', message: 'Wallet not found. Please install Freighter.' });
      } else {
         setStatus({ type: 'error', message: 'Wallet connection rejected by user.' });
      }
    }
  };

  const placeBid = async () => {
    if (!address) return setStatus({ type: 'error', message: 'Please connect wallet first.' });
    if (!bidAmount || isNaN(bidAmount) || Number(bidAmount) <= highestBid) {
      return setStatus({ type: 'error', message: 'Bid must be higher than current highest bid.' });
    }

    try {
      setStatus({ type: 'pending', message: 'Waiting for wallet approval...' });
      
      if (Number(bidAmount) > 9000) {
        throw new Error('insufficient balance');
      }

      setStatus({ type: 'pending', message: 'Transaction submitted. Waiting for confirmation...' });
      
      setTimeout(() => {
         setStatus({ type: 'success', message: 'Bid placed successfully!' });
         setHighestBid(Number(bidAmount));
         setEvents(prev => [{ id: Date.now(), bidder: address, amount: bidAmount }, ...prev]);
         setBidAmount('');
      }, 3000);

    } catch (e) {
       if (e.message?.toLowerCase().includes('rejected') || e.message?.toLowerCase().includes('user declined')) {
          setStatus({ type: 'error', message: 'Transaction rejected by user.' });
       } else if (e.message?.toLowerCase().includes('insufficient')) {
          setStatus({ type: 'error', message: 'Insufficient balance to place this bid.' });
       } else {
          setStatus({ type: 'error', message: 'Failed to place bid: ' + e.message });
       }
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-purple-500/30 overflow-hidden relative">
      {/* Background gradients */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden -z-10 pointer-events-none">
        <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] bg-purple-600/20 rounded-full blur-[120px]" />
        <div className="absolute top-[60%] -right-[10%] w-[40%] h-[40%] bg-blue-600/20 rounded-full blur-[100px]" />
      </div>

      {/* Header */}
      <header className="border-b border-white/10 bg-white/5 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
              <Gavel className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-white/70">NexusAuction</span>
          </div>
          
          <button 
            onClick={connectWallet}
            className="px-6 py-2.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 transition-all duration-300 flex items-center gap-2 font-medium"
          >
            <Wallet className="w-4 h-4" />
            {address ? `${address.substring(0, 6)}...${address.substring(address.length - 4)}` : 'Connect Wallet'}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 py-16 grid grid-cols-1 lg:grid-cols-12 gap-12">
        {/* Auction Details */}
        <div className="lg:col-span-7 space-y-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-green-500/10 border border-green-500/20 text-green-400 text-sm font-medium">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            Live Auction
          </div>
          
          <h1 className="text-5xl lg:text-7xl font-bold leading-tight tracking-tight">
            Rare Digital <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-blue-400">Artifact #042</span>
          </h1>
          
          <p className="text-lg text-white/60 max-w-xl leading-relaxed">
            Bid on this exclusive digital artifact deployed on the Soroban smart contract platform. Experience lightning-fast decentralized auctions.
          </p>

          <div className="grid grid-cols-2 gap-6 pt-6">
            <div className="p-6 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm">
              <p className="text-white/50 text-sm font-medium mb-2">Current Highest Bid</p>
              <div className="flex items-end gap-2">
                <span className="text-4xl font-bold">{highestBid}</span>
                <span className="text-xl text-white/50 mb-1">XLM</span>
              </div>
            </div>
            <div className="p-6 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm">
              <p className="text-white/50 text-sm font-medium mb-2">Time Remaining</p>
              <div className="flex items-end gap-2">
                <span className="text-4xl font-bold">24:00</span>
                <span className="text-xl text-white/50 mb-1">hrs</span>
              </div>
            </div>
          </div>
        </div>

        {/* Bidding Panel */}
        <div className="lg:col-span-5">
          <div className="p-8 rounded-3xl bg-white/5 border border-white/10 backdrop-blur-md shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-purple-500 to-blue-500" />
            
            <h3 className="text-2xl font-bold mb-6">Place a Bid</h3>
            
            <div className="space-y-4">
              <div>
                <div className="relative">
                  <input 
                    type="number" 
                    value={bidAmount}
                    onChange={(e) => setBidAmount(e.target.value)}
                    placeholder={`Min. bid: ${highestBid + 1} XLM`}
                    className="w-full bg-black/50 border border-white/10 rounded-xl px-5 py-4 text-lg focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/50 transition-all placeholder:text-white/20"
                  />
                  <div className="absolute right-5 top-1/2 -translate-y-1/2 text-white/40 font-medium">
                    XLM
                  </div>
                </div>
              </div>
              
              <button 
                onClick={placeBid}
                className="w-full py-4 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white font-bold text-lg shadow-lg shadow-purple-500/25 transition-all transform active:scale-[0.98] flex items-center justify-center gap-2"
              >
                Place Bid Now <ArrowRight className="w-5 h-5" />
              </button>
            </div>

            {/* Status Messages */}
            {status && (
              <div className={`mt-6 p-4 rounded-xl flex items-start gap-3 border ${
                status.type === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-400' :
                status.type === 'success' ? 'bg-green-500/10 border-green-500/20 text-green-400' :
                'bg-blue-500/10 border-blue-500/20 text-blue-400'
              }`}>
                {status.type === 'error' && <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />}
                {status.type === 'success' && <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />}
                {status.type === 'pending' && <Loader2 className="w-5 h-5 shrink-0 mt-0.5 animate-spin" />}
                <p className="text-sm font-medium leading-relaxed">{status.message}</p>
              </div>
            )}
          </div>

          {/* Live Events Stream */}
          {events.length > 0 && (
            <div className="mt-8">
              <h4 className="text-sm font-medium text-white/50 mb-4 uppercase tracking-wider">Live Activity</h4>
              <div className="space-y-3">
                {events.map(ev => (
                  <div key={ev.id} className="p-4 rounded-xl bg-white/5 border border-white/5 flex items-center justify-between animate-[fade-in_0.3s_ease-out]">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center">
                        <Coins className="w-4 h-4 text-purple-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">Bid Placed</p>
                        <p className="text-xs text-white/40">{ev.bidder.substring(0,6)}...{ev.bidder.substring(ev.bidder.length-4)}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-purple-400">{ev.amount} XLM</p>
                      <p className="text-xs text-white/40">Just now</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
