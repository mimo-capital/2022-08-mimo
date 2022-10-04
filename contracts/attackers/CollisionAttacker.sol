// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;


contract CollisionAttacker {
  address public proxyFactory;

  function overrideProxyFactory(address _proxyFactory) external {
    proxyFactory = _proxyFactory;
  }
}
