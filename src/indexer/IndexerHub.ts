import SmartBuffer from '@ylide/smart-buffer';
import { CriticalSection } from '../cross-chain';
import { IMessage, Uint256 } from '../types';

const IS_DEV = true;

const endpoints = IS_DEV
	? ['http://localhost:8495']
	: [
			'https://idx1.ylide.io',
			'https://idx2.ylide.io',
			'https://idx3.ylide.io',
			'https://idx4.ylide.io',
			'https://idx5.ylide.io',
	  ];

export class IndexerHub {
	private endpoint: string = '';
	private lastTryTimestamps: Record<string, number> = {};

	private cs: CriticalSection = new CriticalSection();

	async retryingOperation<T>(callback: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
		if (this.endpoint) {
			try {
				return await callback();
			} catch (err) {
				this.lastTryTimestamps[this.endpoint] = Date.now();
				// tslint:disable-next-line
				// console.error(`Endpoint ${this.endpoint} is unavailable due to the error: `, err);
				this.endpoint = '';
			}
		}
		await this.cs.enter();
		try {
			const _endpoints = endpoints.slice();
			while (_endpoints.length) {
				const tempEndpoint = _endpoints.splice(Math.floor(Math.random() * _endpoints.length), 1)[0];
				if (Date.now() - this.lastTryTimestamps[tempEndpoint] < 20000) {
					continue;
				}
				try {
					const startTime = Date.now();
					const response = await fetch(`${tempEndpoint}/ping`);
					const text = await response.text();
					const endTime = Date.now();
					if (response.status === 200 && text === 'PONG' && endTime - startTime < 5000) {
						this.endpoint = tempEndpoint;
						try {
							return await callback();
						} catch (err) {
							// tslint:disable-next-line
							// console.error(`Endpoint ${this.endpoint} is unavailable due to the error: `, err);
							this.lastTryTimestamps[this.endpoint] = Date.now();
							this.endpoint = '';
						}
					}
				} catch (err) {
					this.lastTryTimestamps[tempEndpoint] = Date.now();
					// tslint:disable-next-line
					// console.error(`Endpoint ${tempEndpoint} is unavailable due to the error: `, err);
				}
			}
		} finally {
			await this.cs.leave();
		}
		// tslint:disable-next-line
		// console.error(`All indexer endpoints were unavailable. Switched back to the direct blockchain reading`);
		return fallback();
	}

	async request(url: string, body: any) {
		const response = await fetch(`${this.endpoint}${url}`, {
			method: 'POST',
			body: JSON.stringify(body),
			headers: {
				'Content-Type': 'text/plain',
			},
		});
		const responseBody = await response.json();
		if (responseBody.result) {
			return responseBody.data;
		} else {
			throw new Error(responseBody.error || 'Response error');
		}
	}

	async requestMultipleKeys(addresses: string[]) {
		const data = await this.request('/multi-keys', { addresses });
		return data;
	}

	async requestKeys(address: string) {
		const data = await this.request('/keys', { address });
		return Object.keys(data).reduce(
			(p, bc) => ({
				...p,
				...(data[bc]
					? {
							[bc]: {
								...data[bc],
								publicKey: SmartBuffer.ofHexString(data[bc].publicKey).bytes,
							},
					  }
					: {}),
			}),
			{},
		) as Record<
			string,
			{
				block: number;
				keyVersion: number;
				publicKey: Uint8Array;
				timestamp: number;
			}
		>;
	}

	async requestMessages({
		blockchain,
		fromBlock,
		toBlock,
		sender,
		recipient,
		type,
		limit,
	}: {
		blockchain: string;
		fromBlock: number | null;
		toBlock: number | null;
		sender: string | null;
		recipient: Uint256 | null;
		type: 'DIRECT' | 'BROADCAST';
		limit: number;
	}): Promise<IMessage[]> {
		const data = await this.request(`/${blockchain}`, {
			fromBlock,
			toBlock,
			sender,
			recipient,
			type,
			limit,
		});
		return data.map((m: any) => ({
			...m,
			key: new Uint8Array(m.key),
		}));
	}
}
