import { Alchemy, Network, AlchemySettings, AssetTransfersWithMetadataParams, AssetTransfersCategory, AssetTransfersWithMetadataResponse, AssetTransfersWithMetadataResult } from 'alchemy-sdk';
import {TraceMap, WalletAddress} from './tracemap';

const settings : AlchemySettings = {
	apiKey : "ZmVMhTdZ2ZJZBbECVu3bFXZPvU6kwKow",
	network : Network.ETH_MAINNET,
};

const alchemy = new Alchemy(settings);
const NONCE_COUNT_HEURISTIC = 100000; // Too many transactions indicator of DeFi degen (good) or exchange (bad)
const TRANSFER_EVENT_COUNT_HEURISTIC = 10000;
const USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const TARGET_ADDRESS = "0x5fd06d66c3e02c12106d6d48e93c3447d85ad0a8";
const START_BLOCK = 12788523;
const END_BLOCK =   START_BLOCK + 6790;
const LIMIT_TRAVERSAL_ADDRESSES = new Set<string> ([
	"0x564286362092d8e7936f0549571a803b203aaced", //Binance3
	"0x3f5ce5fbfe3e9af3971dd833d26ba9b5c936f0be", //Binance
	"0x59a5208b32e627891c389ebafc644145224006e8", //HitBTC2
	"0x97dec872013f6b5fb443861090ad931542878126", //Uniswap USDC
]);

const traceMap = new Map<WalletAddress,Set<WalletAddress>>();

async function recursive_trace(target : WalletAddress) : Promise<number> {

	console.log(`Progress[${traceMap.size}]. Target: ${target}`);
	const promise = new Promise<number>((resolve)=> {
		resolve(0);
	});

	// Wrong. We need the ERC20 asset transfer count, not the EOA nonce....
	const nonceCount = await alchemy.core.getTransactionCount(target);
	if( nonceCount > NONCE_COUNT_HEURISTIC) {
		LIMIT_TRAVERSAL_ADDRESSES.add(target);
		console.log(LIMIT_TRAVERSAL_ADDRESSES);
	}

	if(traceMap.has(target) || LIMIT_TRAVERSAL_ADDRESSES.has(target.toLowerCase())) {
		return promise;
	}

	const alchemyCall = (params : any) => {
		params.withMetadata = false;
		params.category = [AssetTransfersCategory.ERC20];
		params.excludeZeroValue = true;
		params.contractAddresses = [USDC_ADDRESS];
		params.fromAddress = target;
		params.fromBlock = START_BLOCK;
		params.toBlock = END_BLOCK;
		return alchemy.core.getAssetTransfers(params);
	}

	const dataExtract = (response : AssetTransfersWithMetadataResponse) => {
		return response.transfers;
	}

	let transfers : AssetTransfersWithMetadataResult[] = [];
	try {
		transfers = await paginateCall<AssetTransfersWithMetadataResult>(alchemyCall, dataExtract);
	}
	catch(e) {
		// Don't traverse through this wallet address again.
		LIMIT_TRAVERSAL_ADDRESSES.add(target);

		//Swallow exception. Keep array empty.
	}

	traceMap.set(target, new Set<WalletAddress>());
	let entryRef = traceMap.get(target);
	
	for (const x of transfers) {
		if(x.to === null) {
			continue;
		}

		entryRef?.add(x.to); //TODO optimize
		await recursive_trace(x.to);
	};

	return promise;
}

async function paginateCall<T>(alchemyCall : any, dataExtract : any) {
	let pages : T[] = [];
	const params = {
		pageKey : undefined
	};

	do {
		const resp = await alchemyCall(params);
		pages.push(...dataExtract(resp));

		params.pageKey = resp.pageKey;

		if(pages.length >= TRANSFER_EVENT_COUNT_HEURISTIC) {
			throw new RangeError('Too many transfers for optimal processing.')
		}

	} while( params.pageKey !== undefined);

	return pages.flat(1);
}

async function main() {
	await recursive_trace(TARGET_ADDRESS);

	console.log(traceMap);
}

main();