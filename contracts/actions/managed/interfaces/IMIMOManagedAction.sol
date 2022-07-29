// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IPool } from "@aave/core-v3/contracts/interfaces/IPool.sol";

import "../../../core/interfaces/IAddressProvider.sol";
import "../../../core/dex/interfaces/IDexAddressProvider.sol";
import "../../../proxy/interfaces/IMIMOProxyRegistry.sol";

interface IMIMOManagedAction {
  struct ManagedVault {
    bool isManaged;
    address manager;
    uint256 allowedVariation;
    uint256 minRatio;
    uint256 fixedFee;
    uint256 varFee;
    uint256 mcrBuffer;
  }

  event ManagerSet(address manager, bool isManager);
  event ManagementSet(uint256 vaultId, ManagedVault managedVault);

  function setManagement(uint256 vaultId, ManagedVault calldata mgtParams) external;

  function setManager(address manager, bool isManager) external;

  function a() external view returns (IAddressProvider);

  function proxyRegistry() external view returns (IMIMOProxyRegistry);

  function getManagedVault(uint256 vaultId) external view returns (ManagedVault memory);

  function getOperationTracker(uint256 vaultId) external view returns (uint256);

  function getManager(address manager) external view returns (bool);
}
