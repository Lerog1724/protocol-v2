import { task } from 'hardhat/config';
import { getParamPerNetwork } from '../../helpers/contracts-helpers';
import {
  deployLendingPoolAddressesProvider,
  deployLendingPoolAddressesProviderRegistry,
} from '../../helpers/contracts-deployments';
import { notFalsyOrZeroAddress, waitForTx } from '../../helpers/misc-utils';
import {
  ConfigNames,
  loadPoolConfig,
  getGenesisPoolAdmin,
  getEmergencyAdmin,
} from '../../helpers/configuration';
import { eNetwork } from '../../helpers/types';
import {
  getFirstSigner,
  getLendingPoolAddressesProviderRegistry,
} from '../../helpers/contracts-getters';
import { formatEther, isAddress, parseEther } from 'ethers/lib/utils';
import { isZeroAddress } from 'ethereumjs-util';
import { Signer, BigNumber } from 'ethers';
import { parse } from 'path';
//import BigNumber from 'bignumber.js';

task(
  'full:deploy-address-provider',
  'Deploy address provider, registry and fee provider for dev enviroment'
)
  .addFlag('verify', 'Verify contracts at Etherscan')
  .addParam('pool', `Pool name to retrieve configuration, supported: ${Object.values(ConfigNames)}`)
  .setAction(async ({ verify, pool }, DRE) => {
    await DRE.run('set-DRE');
    let signer: Signer;
    const network = <eNetwork>DRE.network.name;
    const poolConfig = loadPoolConfig(pool);
    const { ProviderId, MarketId } = poolConfig;

    const providerRegistryAddress = getParamPerNetwork(poolConfig.ProviderRegistry, network);
    const providerRegistryOwner = getParamPerNetwork(poolConfig.ProviderRegistryOwner, network);

    if (
      !providerRegistryOwner ||
      !isAddress(providerRegistryOwner) ||
      isZeroAddress(providerRegistryOwner)
    ) {
      throw Error('config.ProviderRegistryOwner is missing or is not an address.');
    }

    // Checks if deployer address is registry owner
    if (process.env.MAINNET_FORK === 'true') {
      await DRE.network.provider.request({
        method: 'hardhat_impersonateAccount',
        params: [providerRegistryOwner],
      });
      signer = DRE.ethers.provider.getSigner(providerRegistryOwner);
      const firstAccount = await getFirstSigner();
      await firstAccount.sendTransaction({ value: parseEther('10'), to: providerRegistryOwner });
    } else {
      signer = DRE.ethers.provider.getSigner(providerRegistryOwner);
    }
    // 1. Address Provider Registry instance
    const addressesProviderRegistry = (
      await getLendingPoolAddressesProviderRegistry(providerRegistryAddress)
    ).connect(signer);

    console.log('Registry Address', addressesProviderRegistry.address);

    // 2. Deploy address provider and set genesis manager
    const addressesProvider = await deployLendingPoolAddressesProvider(MarketId, verify);

    // DISABLE SEC. 3 FOR GOVERNANCE USE!
    // 3. Set the provider at the Registry
    await waitForTx(
      await addressesProviderRegistry.registerAddressesProvider(
        addressesProvider.address,
        ProviderId
      )
    );

    // 4. Set pool admins

    await waitForTx(await addressesProvider.setPoolAdmin(await getGenesisPoolAdmin(poolConfig)));
    await waitForTx(await addressesProvider.setEmergencyAdmin(await getEmergencyAdmin(poolConfig)));

    console.log('Pool Admin', await addressesProvider.getPoolAdmin());
    console.log('Emergency Admin', await addressesProvider.getEmergencyAdmin());
  });
