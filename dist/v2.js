// methods that require user interaction
const defaultOptionalMethods = [
    'eth_sendTransaction',
    'eth_signTransaction',
    'personal_sign',
    'eth_sign',
    'eth_signTypedData',
    'eth_signTypedData_v4',
    'wallet_addEthereumChain',
    'wallet_switchEthereumChain'
];
const isHexString = (value) => {
    if (typeof value !== 'string' || !value.match(/^0x[0-9A-Fa-f]*$/)) {
        return false;
    }
    return true;
};
function canxium(options) {
    if (!(options === null || options === void 0 ? void 0 : options.projectId)) {
        throw new Error('WalletConnect requires a projectId. Please visit https://cloud.walletconnect.com to get one.');
    }
    return () => {
        return {
            label: 'Canxium Wallet',
            getIcon: async () => (await import('./icon.js')).default,
            getInterface: async ({ chains, EventEmitter }) => {
                var _a;
                const connectKit = await import('@ledgerhq/connect-kit/dist/umd');
                if (options === null || options === void 0 ? void 0 : options.enableDebugLogs) {
                    connectKit.enableDebugLogs();
                }
                // accept both hex and decimal chain ids
                const requiredChains = (_a = options === null || options === void 0 ? void 0 : options.requiredChains) === null || _a === void 0 ? void 0 : _a.map(id => typeof id === 'string' && isHexString(id)
                    ? parseInt(id, 16)
                    : id);
                const optionalMethods = options.optionalMethods && Array.isArray(options.optionalMethods)
                    ? [...options.optionalMethods, ...defaultOptionalMethods]
                    : defaultOptionalMethods;
                const checkSupportResult = connectKit.checkSupport({
                    providerType: connectKit.SupportedProviders.Ethereum,
                    walletConnectVersion: 2,
                    projectId: options === null || options === void 0 ? void 0 : options.projectId,
                    chains: requiredChains,
                    optionalChains: chains.map(({ id }) => parseInt(id, 16)),
                    methods: options === null || options === void 0 ? void 0 : options.requiredMethods,
                    optionalMethods,
                    events: options === null || options === void 0 ? void 0 : options.requiredEvents,
                    optionalEvents: options === null || options === void 0 ? void 0 : options.optionalEvents,
                    rpcMap: chains
                        .map(({ id, rpcUrl }) => ({ id, rpcUrl }))
                        .reduce((rpcMap, { id, rpcUrl }) => {
                        rpcMap[parseInt(id, 16)] = rpcUrl || '';
                        return rpcMap;
                    }, {})
                });
                // get the provider instance, it can be either the Ledger Extension
                // or WalletConnect
                const instance = (await connectKit.getProvider());
                // return the Ledger Extension provider
                if (checkSupportResult.providerImplementation ===
                    connectKit.SupportedProviderImplementations.LedgerConnect) {
                    return {
                        provider: instance
                    };
                }
                const { ProviderRpcError, ProviderRpcErrorCode } = await import('@web3-onboard/common');
                const { default: EthereumProvider } = await import('@walletconnect/ethereum-provider');
                const { Subject, fromEvent } = await import('rxjs');
                const { takeUntil, take } = await import('rxjs/operators');
                const connector = instance;
                const emitter = new EventEmitter();
                class EthProvider {
                    constructor({ connector, chains }) {
                        this.emit = emitter.emit.bind(emitter);
                        this.on = emitter.on.bind(emitter);
                        this.removeListener = emitter.removeListener.bind(emitter);
                        this.connector = connector;
                        this.chains = chains;
                        this.disconnected$ = new Subject();
                        // listen for accountsChanged
                        fromEvent(this.connector, 'accountsChanged', payload => payload)
                            .pipe(takeUntil(this.disconnected$))
                            .subscribe({
                            next: accounts => {
                                this.emit('accountsChanged', accounts);
                            },
                            error: console.warn
                        });
                        // listen for chainChanged
                        fromEvent(this.connector, 'chainChanged', (payload) => payload)
                            .pipe(takeUntil(this.disconnected$))
                            .subscribe({
                            next: chainId => {
                                const hexChainId = isHexString(chainId)
                                    ? chainId
                                    : `0x${chainId.toString(16)}`;
                                this.emit('chainChanged', hexChainId);
                            },
                            error: console.warn
                        });
                        // listen for disconnect event
                        fromEvent(this.connector, 'session_delete', (payload) => payload)
                            .pipe(takeUntil(this.disconnected$))
                            .subscribe({
                            next: () => {
                                this.emit('accountsChanged', []);
                                this.disconnected$.next(true);
                                typeof localStorage !== 'undefined' &&
                                    localStorage.removeItem('walletconnect');
                            },
                            error: console.warn
                        });
                        this.disconnect = () => {
                            if (this.connector.session)
                                this.connector.disconnect();
                        };
                        const checkForSession = () => {
                            const session = this.connector.session;
                            if (session) {
                                this.emit('accountsChanged', this.connector.accounts);
                                this.emit('chainChanged', this.connector.chainId);
                            }
                        };
                        checkForSession();
                        this.request = async ({ method, params }) => {
                            if (method === 'eth_chainId') {
                                return isHexString(this.connector.chainId)
                                    ? this.connector.chainId
                                    : `0x${this.connector.chainId.toString(16)}`;
                            }
                            if (method === 'eth_requestAccounts') {
                                return new Promise(async (resolve, reject) => {
                                    // Subscribe to connection events
                                    fromEvent(this.connector, 'connect', (payload) => payload)
                                        .pipe(take(1))
                                        .subscribe({
                                        next: ({ chainId }) => {
                                            this.emit('accountsChanged', this.connector.accounts);
                                            const hexChainId = isHexString(chainId)
                                                ? chainId
                                                : `0x${chainId.toString(16)}`;
                                            this.emit('chainChanged', hexChainId);
                                            resolve(this.connector.accounts);
                                        },
                                        error: reject
                                    });
                                    // Check if connection is already established
                                    if (!this.connector.session) {
                                        await instance.request({ method }).catch((err) => {
                                            console.error('err creating new session: ', err);
                                            reject(new ProviderRpcError({
                                                code: 4001,
                                                message: 'User rejected the request.'
                                            }));
                                        });
                                    }
                                    else {
                                        // update ethereum provider to load accounts & chainId
                                        const accounts = this.connector.accounts;
                                        const chainId = this.connector.chainId;
                                        const hexChainId = `0x${chainId.toString(16)}`;
                                        this.emit('chainChanged', hexChainId);
                                        return resolve(accounts);
                                    }
                                });
                            }
                            if (method === 'eth_selectAccounts') {
                                throw new ProviderRpcError({
                                    code: ProviderRpcErrorCode.UNSUPPORTED_METHOD,
                                    message: `The Provider does not support the requested method: ${method}`
                                });
                            }
                            if (method == 'wallet_switchEthereumChain') {
                                if (!params) {
                                    throw new ProviderRpcError({
                                        code: ProviderRpcErrorCode.INVALID_PARAMS,
                                        message: `The Provider requires a chainId to be passed in as an argument`
                                    });
                                }
                                const chainIdObj = params[0];
                                if (!chainIdObj.hasOwnProperty('chainId') ||
                                    typeof chainIdObj['chainId'] === 'undefined') {
                                    throw new ProviderRpcError({
                                        code: ProviderRpcErrorCode.INVALID_PARAMS,
                                        message: `The Provider requires a chainId to be passed in as an argument`
                                    });
                                }
                                return this.connector.request({
                                    method: 'wallet_switchEthereumChain',
                                    params: [
                                        {
                                            chainId: chainIdObj.chainId
                                        }
                                    ]
                                });
                            }
                            return this.connector.request({
                                method,
                                params
                            });
                        };
                    }
                }
                return {
                    provider: new EthProvider({ chains, connector })
                };
            }
        };
    };
}
export default canxium;
