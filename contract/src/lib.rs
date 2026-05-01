#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, Env, String,
};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Seller,
    ItemName,
    Token,
    HighestBid,
    HighestBidder,
    IsActive,
}

#[contract]
pub struct AuctionContract;

#[contractimpl]
impl AuctionContract {
    /// Initialize the auction
    pub fn init(
        env: Env,
        seller: Address,
        item_name: String,
        token: Address,
        min_bid: i128,
    ) {
        seller.require_auth();
        
        let is_active: Option<bool> = env.storage().instance().get(&DataKey::IsActive);
        if is_active.is_some() {
            panic!("Auction is already initialized");
        }

        env.storage().instance().set(&DataKey::Seller, &seller);
        env.storage().instance().set(&DataKey::ItemName, &item_name);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::HighestBid, &min_bid);
        env.storage().instance().set(&DataKey::IsActive, &true);
    }

    /// Place a bid
    pub fn bid(env: Env, bidder: Address, amount: i128) {
        bidder.require_auth();
        
        let is_active: bool = env.storage().instance().get(&DataKey::IsActive).unwrap_or(false);
        if !is_active {
            panic!("Auction is not active");
        }

        let highest_bid: i128 = env.storage().instance().get(&DataKey::HighestBid).unwrap_or(0);
        if amount <= highest_bid {
            panic!("Bid must be higher than current highest bid");
        }

        let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token);

        // Transfer funds from bidder to contract
        token_client.transfer(&bidder, &env.current_contract_address(), &amount);

        // Refund previous bidder if any
        if let Some(prev_bidder) = env.storage().instance().get::<_, Address>(&DataKey::HighestBidder) {
            token_client.transfer(&env.current_contract_address(), &prev_bidder, &highest_bid);
        }

        // Update state
        env.storage().instance().set(&DataKey::HighestBid, &amount);
        env.storage().instance().set(&DataKey::HighestBidder, &bidder);

        // Emit event
        let topics = (symbol_short!("bid"), bidder.clone());
        env.events().publish(topics, amount);
    }

    /// End the auction and transfer funds to seller
    pub fn end_auction(env: Env) {
        let seller: Address = env.storage().instance().get(&DataKey::Seller).unwrap();
        seller.require_auth();

        let is_active: bool = env.storage().instance().get(&DataKey::IsActive).unwrap_or(false);
        if !is_active {
            panic!("Auction is already ended");
        }

        env.storage().instance().set(&DataKey::IsActive, &false);

        // Transfer funds to seller if there was a bid
        if let Some(_) = env.storage().instance().get::<_, Address>(&DataKey::HighestBidder) {
            let highest_bid: i128 = env.storage().instance().get(&DataKey::HighestBid).unwrap_or(0);
            let token: Address = env.storage().instance().get(&DataKey::Token).unwrap();
            let token_client = token::Client::new(&env, &token);
            token_client.transfer(&env.current_contract_address(), &seller, &highest_bid);
        }

        // Emit event
        let topics = (symbol_short!("ended"), seller.clone());
        env.events().publish(topics, true);
    }

    /// Get current highest bid
    pub fn get_highest_bid(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::HighestBid).unwrap_or(0)
    }

    /// Get current highest bidder
    pub fn get_highest_bidder(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::HighestBidder)
    }

    /// Get auction status
    pub fn is_active(env: Env) -> bool {
        env.storage().instance().get(&DataKey::IsActive).unwrap_or(false)
    }

    /// Get item name
    pub fn get_item_name(env: Env) -> String {
        env.storage().instance().get(&DataKey::ItemName).unwrap()
    }
}
