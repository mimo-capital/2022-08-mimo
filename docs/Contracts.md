# Contracts Interfaces 

## Inheritable Functions
SuperVaults V2 extracts out integraiton with external contracts into inherited contracts for modular functionality.These contracts are inherited from the `SuperVault V2` actions contracts. 

### MIMOFlashLoan
The MIMOFlashLoan handles taking an AAVE flashloan and executing it. 

#### constructor
params:
-  `address _lendingPool` : the address of the AAVE lending pool

#### _takeFlashLoan 
Initiates an AAVE flashloan 

params:
- `FlashLoanData memory flData` : FlashloanData struct containing flashloan asset, amount and params 
-  `bytes memory params` : The params to be passed onto the `executeOperation()` call 

#### executeOperation 
Carries out the flashloan logic - must be overidden by the inheriting contract

params:
- `address[] calldata assets` - The assets that have been flashloaned
- `uint256[] calldata amounts` - The corresponding amount of each asset that has been flashloaned
- `uint256[] calldata premiums` - The flashloan fees that need to be repaid by the end of the tx
- `address initiator` - The initiator of the loan (used to secure access control)
- `bytes calldata params` - Any additional encoded data to carry out the flashloan call 

### MIMOSwap 
The MIMOswap contract handles querying the `dexAddressProvider` for an aggregator approved by the protocol at a given index, and carrying out a swap on the aggregator. 

#### constructor

params:
- `IAddressProvider _a` : The address provider for the whole protocol
- `IDexAddressProvider _dexAP` : The dex address provider for the whole protocol

#### _aggregatorSwap
Helper function to approve and swap an asset using an aggregator

params: 
-  `IERC20 token` : The starting token to swap for another asset
- `uint256 amount` : The amount of starting token to swap for
- `SwapData calldata swapData` : SwapData containing dex index to use to swap and low-level data to call the aggregator with

## Contracts and Functions 
Besides the main `MIMOVaultAction`, SuperVaults V2 extracts most vault actions into their own contracts to integrate with DefiSaver's executor function and for modular upgradeability and access control.  Each of the actions contract handle the logic and aren't meant to hold any state, since they are only used through `delegateCall` from the MIMOProxy. 

### MIMOProxy
The base `MIMOProxy` contract used for each `MIMOProxy` clone. Since this contract is meant to be a clone, there is no constructor function, but instead an initialize function. In addition allowing for access control where only the owner can make proxy calls, this iproxy contract also allows for giving permission to specific addresses for calling specific functions on other contracts.  

#### Initialize
Initializes a `MIMOProxy` clone and sets the sender as the owner. 

#### getPermission 
Returns true if a given `envoy` address can call a `target` contract's given `selector` function, and false otherwise. 

params:
- `address envoy` : The caller 
- `address target` : The target contract called by the envoy   
- `bytes4 selector` : The selector of the method of the target contract called by the envoy

#### Owner
Returns the address of the owner of the clone. Only one owner can exist at any time per cloned contract.

#### minGasReserve
Returns how much gas to reserve for running the remainder of the "execute" function after the DELEGATECALL. This prevents the proxy from becoming unusable if EVM opcode gas costs change in the future.

#### execute
Delegate calls to the target contract by forwarding the call data. Returns the data it gets back, including when the contract call reverts with a reason or custom error. The caller must be either an owner or an envoy.

params:
`address target` : The address of the target contract to call 
`bytes calldata data` :  Function selector plus ABI encoded data.

#### setPermission
Gives or takes a permission from an envoy to call the given target contract and function selector on behalf of the owner.

params:
`address envoy` : The address of the envoy account.
`address target` : The address of the target contract.
`bytes4 selector` : The 4 byte function selector on the target contract.
`bool permission` : The boolean permission to set.

#### transferOwnership
Transfers the owner of the contract to a new account.

params:
`address newOwner` : The address of the new owner account.

#### multicall
Batches multiple proxy calls within a same transaction. Note: this differs from the design of the original PRB proxy that this design was based off of. For example, this might be useful for transactions that require doing multiple vault operations on `VaultsCore`.

params:
`address[] calldata targets` : An array of contract addresses to call 
`bytes[] calldata data` : The bytes for each batched function call 

### MIMOProxyFactory
The factory contract used by `MIMOProxyRegistry` for creating simple `MIMOProxy` clones. 

####  isProxy
Mapping to track all deployed proxies.

params: 
`address proxy` : The address of the proxy to check. 


#### deploy
Clones a new `MIMOProxy` and sets `msg.sender` as the owner of the new proxy clone.

#### deployFor 
Deploys a new proxy for the given owner and returns the adddress of the new proxy
  
params:
`address owner` : The owner of the proxy.

### MIMOProxyRegistry
The `MIMOProxyRegistry` is used for. Before using `SuperVaults V2`, the user must create a clone using this factory. 

#### getCurrentProxy
Gets the current proxy of the given owner.
params:
`address owner` : The address of the owner of the current proxy.

#### deploy
Deploys and registers a new proxy instance via the proxy factory and sets `msg.sender` as the proxy owner.

#### deployFor
Deploys and registers a new proxy instance via the proxy factory for the given owner.
  
params:
`address owner` : The owner of the proxy.

### MIMOVaultAction 
A set of basic vault operations supported by vaultsCore. Used by a `MIMOProxy` clone to do vault operations via a `delegateCall`.  Note: The vault must be have created through a delegateCall from the `MIMOProxy` clone, to do other operations  

#### constructor

params: 
`IVaultsCore _core` : The address of the MIMO protocol VaultsCore 
`IVaultsDataProvider _vaultsData` : The address of MIMO VaultsDataProvider 
`IERC20 _stablex` : The address of the _stablex associated with the vaultsCore

#### deposit 
Deposit collateral into a vault through a delegatecall to a MIMOProxy clone all through a delegatecall to a MIMOProxy clone. Requires approval of asset for amount before calling
`IERC20 collateral` : Address of the collateral type
`uint256 amount` : Amount to deposit

#### depositETH
Wrap ETH and deposit WETH as collateral into a vault, all through a delegatecall to a MIMOProxy clone  

#### depositAndBorrow
Deposit collateral into a vault and borrow PAR through a delegatecall to a MIMOProxy clone. Requires approval of asset for amount before calling

params:
`IERC20 collateral` : The collateral to deposit 
`uint256 depositAmount` : Amount to deposit
`uint256 borrowAmount` : Amount of PAR to borrow after depositing

#### depositETHAndBorrow
Wrap ETH and deposit WETH as collateral into a vault, then borrow PAR from vault through a delegatecall to a MIMOProxy clone

params:
`uint borrowAmount` : The amount of PAR to borrow after depositing ETH

#### withdraw 
Withdraw collateral from a vault through a delegatecall to a MIMOProxy clone. Vault must have been created through the MIMOProxy contract 

params:
`uint vaultId` : The ID of the vault to withdraw from
`uint amount` : The amount of collateral to withdraw

#### withdrawETH
Withdraw WETH from a vault and return to the user as ETH, all through a delegatecall to a MIMOProxy clone
`uint vaultId` : The ID of the vault to withdraw from  
`uint amount` : The amount of ETH to withdraw 

#### borrow()
Borrow PAR from a vault through a delegatecall to a MIMOProxy clone.

params:
`uint256 vaultId` : vaultId The ID of the vault to borrow from
`uint256 amount` : The amount of PAR to borrow

### MIMOLeverage
A `SuperVault V2` action contract that can be used to leverage collateral on the MIMO protocol, and utilizes a flashloan protocol and dex aggregators to do so. The `executeAction` method for this contract should be called through a `MIMOProxy` clone using a `delegateCall`, so the `MIMOProxy` clone will be the owner of the leveraged vault.

#### constructor
params:
`IAddressProvider _a` :  The addressProvider for the MIMO protocol 
`IPool _lendingPool` : The AAVE lending pool used for flashloans 
`IDexAddressProvider _dexAP` : The dexAddressProvider for the MIMO protocol 
`IMIMOProxyRegistry _proxyRegistry` : The MIMOProxyRegistry used to verify access control 

#### executeAction
Leverage an asset using a flashloan to balance collateral. The leveraged vault must have been created though a MIMOProxy. This will trigger a call to executeOperation from the flashLoan.

params:
`calldata _calldata` : Bytes containing depositAmount, stablex swapAmount, struct FlashloanDat data and struc SwapData

#### executeOperation
Executes a leverage operation after taking a flashloan 

params:
`address[] assets` : Address array with one element corresponding to the address of the target vault asset
`uint[] amounts` : Uint array with one element corresponding to the amount of the target vault asset
`uint[] premiums` : Uint array with one element corresponding to the flashLoan fees
`address initiator` : Initiator of the flashloan; can only be MIMOProxy owner
`bytes[] params` : Bytes sent by this contract containing MIMOProxy owner, target vault id, SwapData struct

#### leverageOperation
Used by executeOperation through MIMOProxy callback to perform leverage logic within MIMOProxy context
params:
`IERC20 token` : ERC20 token to leverage
`uint swapAmount` : Stablex swap amount
`uint flashloanRepayAmount` : Amount to be repaid for the flashloan
`SwapData swapData` : SwapData passed from the flashloan call 

### MIMORebalance 
A `SuperVault V2` action contract that can be used to rebalance a an existing vault's debt and collateral to another collateral without requiring any capital through utilzing a flashloan protocol and dex aggregators. The `executeAction` should be called through a `MIMOProxy` clone using a `delegateCall`, so the vault to be rebalanced must have been created through the `MIMOProxy` clone.  

#### constructor
params:
`IAddressProvider _a` :  The addressProvider for the MIMO protocol 
`IPool _lendingPool` : The AAVE lending pool used for flashloans 
`IDexAddressProvider _dexAP` : The dexAddressProvider for the MIMO protocol 
`IMIMOProxyRegistry _proxyRegistry` : The MIMOProxyRegistry used to verify access control 

#### executeAction
Uses a flashloan to exchange one collateral type for another, e.g. to hold less volatile collateral. Vault must have been created though a MIMOProxy
params:
`calldata _calldata` : Bytes containing depositAmount, stablex swapAmount, struct FlashloanDat data and struc SwapData

#### executeOperation
Executes a rebalance operation after taking a flashloan 

params:
`address[] assets` : Address array with one element corresponding to the address of the reblanced asset
`uint[] amounts` : Uint array with one element corresponding to the amount of the rebalanced asset 
`uint[] premiums` : Uint array with one element corresponding to the flashLoan fees 
`address initiator` : Initiator of the flashloan; can only be MIMOProxy owner 
`bytes[] params` : Bytes sent by this contract containing MIMOProxy owner, RebalanceData struct and SwapData struct

#### rebalanceOperation 
Used by executeOperation through MIMOProxy callback to perform leverage logic within MIMOProxy context
params:
`address fromCollateral` : The ERC20 token to rebalance from
`uint swapAmount` : The amount of collateral to swap to for par to repay vaultdebt
`uint flashloanRepayAmount` : The amount that needs to be repaid for the flashloan
`uint fee` : Optional fee to be passed in the context of a ManagedRebalance to mint additional stablex to pay manager
`RebalanceData rbData` : RebalanceData passed from the flashloan call
`SwapData swapData` : SwapData passed from the flashloan call

### MIMOEmptyVault 
A `SuperVault V2` action contract for repaying an existing vault's debt and withdrawing all collateral without any additional capital. Utilzing a flashloan protocol and dex aggregator to do so. The `executeAction` should be called through a `MIMOProxy` clone using a `delegateCall`, so the vault to be emptied must have been created through the `MIMOProxy` clone.  

#### constructor
params:
`IAddressProvider _a` :  The addressProvider for the MIMO protocol 
`IPool _lendingPool` : The AAVE lending pool used for flashloans 
`IDexAddressProvider _dexAP` : The dexAddressProvider for the MIMO protocol 
`IMIMOProxyRegistry _proxyRegistry` : The MIMOProxyRegistry used to verify access control 

#### executeAction
Uses a flashloan to repay all debts for a vault and send all collateral in the vault to the owner. Vault must have been created though a MIMOProxy

params:
`calldata _calldata` : Bytes containing depositAmount, stablex swapAmount, struct FlashloanDat data and struc SwapData

#### executeOperation
Executes an emptyVault operation after taking a flashloan 

params:
`address[] assets` : Address array with one element corresponding to the address of the target vault asset
`uint[] amounts` : Uint array with one element corresponding to the amount of the target vault asset 
`uint[] premiums` : Uint array with one element corresponding to the flashLoan fees 
`address initiator` : Initiator of the flashloan; can only be MIMOProxy owner 
`bytes[] params` : Bytes sent by this contract containing MIMOProxy owner, RebalanceData struct and SwapData struct

#### emptyVaultOperation 
Used by executeOperation through MIMOProxy callback to perform leverage logic within MIMOProxy context. There will likely be some leftover par after repaying the loan; that will also be sent back to the user. 

params:
`address vaultCollateral` : Collateral of the vault to empty 
`uint vaultId` : VaultId of the vault to be emptied
`uint swapAmount` : Amount of collateral to swap to for par to repay vaultdebt 
`SwapData swapData` : SwapData passed from the flashloan call


### MIMOAutoRebalance
A `SuperVault V2` action contract for configuring a vault to be autorebalanced. This allows anyone to rebalance the vault, as long as the rebalance meets the `autoRebalance` configuration. This contract only serves to change the access control and enforce the `autoRebalance` configuration; the actual rebalance logic is done through the `MIMORebalance` contract through a `delegateCall` from a `MIMOProxy` clone, so the vault to be emptied must have been created through the `MIMOProxy` clone.  

#### constructor
params:
`IAddressProvider _a` :  The addressProvider for the MIMO protocol 
`IPool _lendingPool` : The AAVE lending pool used for flashloans 
`IMIMOProxyRegistry _proxyRegistry` : The MIMOProxyRegistry used to verify access control 
`address _mimoRebalance` : The MIMORebalance contract address that holds the logic for the rebalance call 

#### rebalance
Perform a rebalance on a vault on behalf of vault owner. Vault must have been created though a MIMOProxy. Can be called by anyone but reverts if operation results in vault value change above allowed variation or in vault ratio lower than min ratio

params:
`uint vaultId` : Vault id of the vault to rebalance
`SwapData swapData` : SwapData struct containing aggegator swap parameters

#### executeOperation
Routes a call from a flashloan pool to a rebalance operation

params:
`address[] assets` : Address array with one element corresponding to the address of the reblanced asset
`uint[] amounts` : Uint array with one element corresponding to the amount of the rebalanced asset
`uint[] premiums` : Uint array with one element corresponding to the flashLoan fees
`address initiator` : Initiator of the flashloan; can only be MIMOProxy owner
`bytes[] params` : Bytes sent by this contract containing MIMOProxy owner, RebalanceData struct and SwapData struct

#### getAmounts
Getter function returning rebalance amounts for specific vault id

params:
`uint vaultId` : Vault id of the vault to rebalance
`address toCollateral` : Collateral to rebalance to

#### _getAmounts
Helper function calculating the amount to rebalance from vault A and to mint from vault B with rebalnce formula

params:
`AutomatedVault autoVault` : AutomatedVault struct of the vault to rebalance
`VaultState vaultState` : VaultState struct og the vault to rebalance
`address toCollateral` : Collateral to rebalance to

#### getRebalanceParams
Helper function formatting FlashloanData and RebalanceData parameters

params:
`AutomatedVault autoVault` : AutomatedVault struct of the vault to rebalance
`VaultState vaultState` : VaultState struct of the vault to rebalance
`address toCollateral` : Collateral to rebalance to
`uint vaultId` : Vault id of the vault to rebalance

#### _preRebalanceChecks
Helper function performing pre rebalance operation sanity checks. Checks that vault is automated, that maximum daily operation was not reached and that trigger ratio was reached

params:
`AutomatedVault autoVault` :AutomatedVault struct of the vault to rebalance
`uint vaultId` : Vault id of the vault to rebalance
`uint vaultARatio` : Collateral to debt ratio of the vault to rebalance

#### _postRebalanceChecks
Helper function performing post rebalance operation sanity checks. Checks that change in global vault value (vault A + B) is below allowedVaration and vault A ratio equal or above targetRatio
    
params:
`AutomatedVault autoVault` : AutomatedVault struct of the vault to rebalance
`uint rebalanceAmount` : Rebalanced amount
`uint vaultBBalanceBefore` : Collateral balance of the vault to be rebalanced to before the rebalance operation
`uint vaultId` : Vault id of the vault to rebalance
`address vaultOwner` : Rebalanced vault owner
`IVaultsDataProvider vaultsData` : Cached VaultsDataProvider interface for gas saving
    
### MIMOManagedRebalance
A `SuperVault V2` action contract for configuring a vault to have a manged rebalance. This allows a single whitelested manager address to rebalance the vault, as long as the rebalance meets the `managedRebalance` configuration. This contract only serves to change the access control and enforce the `managedRebalance` configuration; the actual rebalance logic is done through the `MIMORebalance` contract through a `delegateCall` from a `MIMOProxy` clone, so the vault to be emptied must have been created through the `MIMOProxy` clone.   

#### constructor
params:
`IAddressProvider _a` :  The addressProvider for the MIMO protocol 
`IPool _lendingPool` : The AAVE lending pool used for flashloans 
`IMIMOProxyRegistry _proxyRegistry` : The MIMOProxyRegistry used to verify access control 
`address _mimoRebalance` : The MIMORebalance contract address that holds the logic for the rebalance call 


#### rebalance
Perform a rebalance on a vault by an appointed whitelisted manager on behalf of vault owner. Vault must have been created though a MIMOProxy. Can only be called once a day by the manager selected by the MIMOProxy owner. Reverts if operation results in vault value change above allowed variation or in vault ratio lower than min ratio

params:
`FashloanData flData` : Flashloan data struct containing flashloan parameters
`RebalanceData rbData` : RebalanceData struct containing rebalance operation parameters
`SwapData swapData` : SwapData struct containing aggegator swap parameters

#### executeOperation
Routes a call from a flashloan pool to a rebalance operation

params:
`address[] assets` : Address array with one element corresponding to the address of the reblanced asset
`uint[] amounts` : Uint array with one element corresponding to the amount of the rebalanced asset
`uint[] premiums` : Uint array with one element corresponding to the flashLoan fees
`address initiator` : Initiator of the flashloan; can only be MIMOProxy owner
`bytes[] params` : Bytes sent by this contract containing MIMOProxy owner, RebalanceData struct and SwapData struct

#### _preRebalanceChecks
Helper function performing pre rebalance operation sanity checks.  Checks that vault is managed, that rebalance was called by manager, and maximum daily operation was not reached 

params:
`ManagedVault managedVault` : ManagedVault struct of the vault to rebalance
`RebalanceData rbData` : RebalanceData struct of the vault to rebalance
`IVaultsDataProvider vaultsData` : Cached VaultsDataProvider interface for gas saving

#### _postRebalanceChecks
Helper function performing post rebalance operation sanity checks. Checks that change in global vault value (vault A + B) is below allowedVaration and vault A & B ratios are at least targetRatios
`ManagedVault managedVault` :  ManagedVault struct of the vault to rebalance
`uint rebalanceAmount` : Rebalanced amount
`uint vaultBBalanceBefore` : Collateral balance of the vault to be rebalanced to before the rebalance operation
`uint vaultId` : Vault id of the vault to rebalance
`address vaultOwner` : Rebalanced vault owner
`address toCollateral` : Collateral to rebalance to
`IVaultsDataProvider vaultsData` : Cached VaultsDataProvider interface for gas saving