use crate::*;

pub type SeriesName = String;
pub type OwnerArgs = HashMap<String, String>;

#[derive(Clone)]
#[derive(BorshDeserialize, BorshSerialize)]
#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct SeriesArgs {
    pub name: String,
    pub mint: Vec<String>,
    pub owner: Vec<String>,
}

#[derive(BorshDeserialize, BorshSerialize)]
#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct SeriesParams {
    pub max_supply: U64,
    pub enforce_unique_args: bool,
    pub mint: Vec<String>,
    pub owner: Vec<String>,
    pub packages: Vec<String>,
}

#[derive(BorshDeserialize, BorshSerialize)]
pub struct Series {
    pub name: String,
    pub src: String,
    pub owner_id: AccountId,
    pub approved_account_ids: LookupSet<AccountId>,
    pub issued_at: U64,
    pub params: SeriesParams,
}


#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct SeriesJson {
    pub name: String,
    pub src: String,
    pub owner_id: AccountId,
    pub approved_account_ids: Vec<AccountId>,
    pub issued_at: U64,
    pub params: SeriesParams,
}


#[near_bindgen]
impl Contract {

    #[payable]
    pub fn series_create (
        &mut self,
        series_name: String,
        src: String,
        params: SeriesParams,
    ) {
        assert_at_least_one_yocto();
        let initial_storage_usage = env::storage_usage();

        let owner_id = env::predecessor_account_id();

        self.series_by_name.insert(&series_name, &Series {
            name: series_name.clone(),
            src,
            owner_id: owner_id.clone(),
            issued_at: env::block_timestamp().into(),
            params,
            approved_account_ids: LookupSet::new(
                StorageKey::SeriesApprovedIds {
                    series_name_hash: hash_account_id(&series_name),
                }
                .try_to_vec()
                .unwrap(),
            )
        });

        let mut series_per_owner = self.series_per_owner
            .get(&owner_id)
            .unwrap_or_else(|| {
                UnorderedSet::new(
                    StorageKey::SeriesPerOwnerInner {
                        account_id_hash: hash_account_id(&owner_id),
                    }
                    .try_to_vec()
                    .unwrap(),
                )
            });
        series_per_owner.insert(&series_name);
        self.series_per_owner.insert(&owner_id, &series_per_owner);

        let required_storage_in_bytes = env::storage_usage().saturating_sub(initial_storage_usage);
        refund_deposit(required_storage_in_bytes);
    }

    #[payable]
    pub fn series_approve (
        &mut self,
        series_name: String,
        account_id: ValidAccountId,
        msg: Option<String>,
    ) {
        assert_at_least_one_yocto();
        let initial_storage_usage = env::storage_usage();

        let mut series = self.series_by_name.get(&series_name).expect("Not valid series");
        assert_eq!(series.owner_id, env::predecessor_account_id(), "Must be series owner");

        series.approved_account_ids.insert(account_id.as_ref());

        if let Some(msg) = msg {
            ext_non_fungible_series_approval_receiver::series_on_approve(
                series_name,
                series.owner_id,
                msg,
                account_id.as_ref(),
                NO_DEPOSIT,
                env::prepaid_gas() - GAS_FOR_SERIES_APPROVE,
            )
            .as_return(); // Returning this promise
        }

        let required_storage_in_bytes = env::storage_usage().saturating_sub(initial_storage_usage);
        refund_deposit(required_storage_in_bytes);
    }

    /// token specific methods because they are part of this series

    #[payable]
    pub fn update_token_owner_args(
        &mut self,
        token_id: TokenId,
        owner_args: OwnerArgs,
    ) {
        assert_at_least_one_yocto();
        let initial_storage_usage = env::storage_usage();
    
        let mut token_data = self.token_data_by_id.get(&token_id).unwrap_or_else(|| panic!("No token {}", token_id));
        let series = self.series_by_name.get(&token_data.series_args.name)
            .unwrap_or_else(|| panic!("No series {}", token_data.series_args.name));

        for (name, value) in &owner_args {
            let index = series.params.owner.iter().position(|v| v == name);
            if index.is_none() {
                log!("Skipping: {}. This is not a parameter of series: {}", name, token_data.series_args.name);
                continue;
            }
            token_data.series_args.owner[index.unwrap()] = value.clone();
            self.token_data_by_id.insert(&token_id, &token_data);
        }

        let required_storage_in_bytes = env::storage_usage().saturating_sub(initial_storage_usage);
        refund_deposit(required_storage_in_bytes);
    }


    // pub fn get_series(
    //     &self,
    //     name: SeriesName,
    // ) -> Series {
    //     self.series_by_name.get(&name).unwrap_or_else(|| panic!("No series {}", name))
    // }

    // pub fn get_series_range(
    //     &self,
    //     from_index: U64,
    //     limit: U64,
    // ) -> Vec<Series> {
    //     let mut tmp = vec![];
    //     let keys = self.series_by_name.keys_as_vector();
    //     let start = u64::from(from_index);
    //     let end = min(start + u64::from(limit), keys.len());
    //     for i in start..end {
    //         let name = keys.get(i).unwrap();
    //         tmp.push(self.series_by_name.get(&name).unwrap());
    //     }
    //     tmp
    // }

    // pub fn get_series_per_owner(
    //     &self,
    //     account_id: AccountId,
    //     from_index: U64,
    //     limit: U64,
    // ) -> Vec<Series> {
    //     let mut tmp = vec![];
    //     let series_per_owner = self.series_per_owner.get(&account_id);
    //     let series = if let Some(series_per_owner) = series_per_owner {
    //         series_per_owner
    //     } else {
    //         return vec![];
    //     };
    //     let keys = series.as_vector();
    //     let start = u64::from(from_index);
    //     let end = min(start + u64::from(limit), keys.len());
    //     for i in start..end {
    //         let name = keys.get(i).unwrap();
    //         tmp.push(self.series_by_name.get(&name).unwrap());
    //     }
    //     tmp
    // }
}


#[ext_contract(ext_non_fungible_series_approval_receiver)]
trait NonFungibleSeriesApprovalReceiver {
    fn series_on_approve(
        &mut self,
        series_name: SeriesName,
        owner_id: AccountId,
        msg: String,
    );
}