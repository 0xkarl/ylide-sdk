import { EventEmitter } from 'eventemitter3';
import { AbstractBlockchainController } from '../../abstracts';
import { IndexerHub } from '../../indexer/IndexerHub';
import { IMessage, IMessageBase, Uint256 } from '../../types';
import { asyncTimer } from '../../utils/asyncTimer';
import { BlockchainSourceType, ISourceSubject } from '../BlockchainSource';
import { GenericListSource } from './ListSource';

/**
 * @internal
 */
export class IndexerListSource extends EventEmitter implements GenericListSource {
	protected pullTimer: any;
	protected lastMessage: IMessage | null = null;

	constructor(
		public readonly originalSource: GenericListSource,
		public readonly indexerHub: IndexerHub,
		public readonly reader: AbstractBlockchainController,
		public readonly subject: ISourceSubject,
		protected _pullCycle: number = 7000,
		public readonly limit = 50,
		public readonly meta: any = null,
	) {
		super();
	}

	pause() {
		if (this.pullTimer) {
			this.pullTimer();
		}
	}

	resume(since?: IMessageBase | undefined): void {
		this.lastMessage = since || null;
		if (!this.pullTimer) {
			this.pullTimer = asyncTimer(this.pull.bind(this), this._pullCycle);
		}
	}

	compare = (a: IMessage, b: IMessage): number => {
		if (a.createdAt === b.createdAt) {
			return this.reader.compareMessagesTime(a, b);
		} else {
			return a.createdAt - b.createdAt;
		}
	};

	async retrieveMessageHistoryByBounds(
		sender: string | null,
		recipient: Uint256 | null,
		fromMessage?: IMessage,
		toMessage?: IMessage,
		limit?: number,
	): Promise<IMessage[]> {
		const msgs = await this.indexerHub.requestMessages({
			blockchain: this.reader.blockchain(),
			fromBlock: fromMessage ? fromMessage.$$blockchainMetaDontUseThisField.block.number : null,
			toBlock: toMessage ? toMessage.$$blockchainMetaDontUseThisField.block.number : null,
			sender,
			recipient,
			type: 'DIRECT',
			limit: limit || 10,
		});

		const toMessageIncluding = false;
		const fromMessageIncluding = false;

		const topBound = toMessage ? msgs.findIndex(r => r.msgId === toMessage.msgId) : -1;
		const bottomBound = fromMessage ? msgs.findIndex(r => r.msgId === fromMessage.msgId) : -1;

		return msgs.slice(
			topBound === -1 ? 0 : (toMessageIncluding ? topBound - 1 : topBound) + 1,
			bottomBound === -1 ? undefined : fromMessageIncluding ? bottomBound + 1 : bottomBound,
		);
	}

	async getBefore(entry: IMessage, limit: number): Promise<IMessage[]> {
		if (this.subject.type === BlockchainSourceType.DIRECT) {
			const subject = this.subject;
			return await this.indexerHub.retryingOperation(
				async () => {
					return await this.retrieveMessageHistoryByBounds(
						subject.sender,
						subject.recipient,
						undefined,
						entry,
						limit,
					);
				},
				async () => {
					return await this.originalSource.getBefore(entry, limit);
				},
			);
		} else {
			return await this.originalSource.getBefore(entry, limit);
		}
	}

	async getAfter(entry: IMessage, limit: number): Promise<IMessage[]> {
		if (this.subject.type === BlockchainSourceType.DIRECT) {
			const subject = this.subject;
			return await this.indexerHub.retryingOperation(
				async () => {
					return await this.retrieveMessageHistoryByBounds(
						subject.sender,
						subject.recipient,
						entry,
						undefined,
						limit,
					);
				},
				async () => {
					return await this.originalSource.getAfter(entry, limit);
				},
			);
		} else {
			return await this.originalSource.getAfter(entry, limit);
		}
	}

	async getLast(limit: number, upToIncluding?: IMessage, mutableParams?: any): Promise<IMessage[]> {
		if (this.subject.type === BlockchainSourceType.DIRECT) {
			const subject = this.subject;
			return await this.indexerHub.retryingOperation(
				async () => {
					return await this.retrieveMessageHistoryByBounds(
						subject.sender,
						subject.recipient,
						undefined,
						undefined,
						limit,
					);
				},
				async () => {
					return await this.originalSource.getLast(limit, upToIncluding, mutableParams);
				},
			);
		} else {
			return await this.originalSource.getLast(limit, upToIncluding, mutableParams);
		}
	}

	protected async pull() {
		const messages = this.lastMessage
			? await this.getAfter(this.lastMessage, this.limit)
			: await this.getLast(this.limit);
		if (messages.length) {
			this.lastMessage = messages[0];
			this.emit('messages', { reader: this.reader, subject: this.subject, messages });
		}
	}
}
