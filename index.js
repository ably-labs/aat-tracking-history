#!/usr/bin/env node

require('dotenv').config();

const { inspect } = require('util');
const ably = require('ably');

/**
 * Process an array of deliveries of the form {id, start, end}
 * id: the trackable id;
 * start: start time for the delivery, as an ISO date time string
 * end: end time for the delivery, as an ISO date time string
 */

async function processDeliveries(deliveries) {
	const key = process.env.ABLY_API_KEY;
	if(!key) {
		throw new Error('Unable to process deliveries; ABLY_API_KEY is not set');
	}
	const client = new ably.Rest({key, log:{level:4}, useBinaryProtocol: false});
	const histories = new Map();
	await deliveries.forEach(async (delivery) => {
		const deliveryHistory =  await processDelivery(client, delivery);
		console.log(`Delivery: ${delivery.id}\n${inspect(deliveryHistory)}\n`);
		histories.set(delivery.id, deliveryHistory);
	});
	return histories;
}

/**
 * Process a single delivery
 * 
 * Arguments
 * client: Ably REST client;
 * id: the trackable id;
 * start: start time for the delivery, as an ISO date time string
 * end: end time for the delivery, as an ISO date time string
 * 
 * Returns
 * Information about the presence of participants in the delivery
 * {
 *   publisherPresentMillis: the total time that at least one publisher is present
 *   publisherPresentPercent: the percentage of time that at least one publisher is present
 *   subscriberPresentMillis: the total time that at least one subscriber is present
 *   subscriberPresentPercent: the percentage of time that at least one subscriber is present
 *   bothPresentMillis: the total time that both a publisher and a subscriber are present
 *   bothPresentPercent: the percentage of time that both a publisher and a subscriber are present
 *   earliestPublisherPresent: the earliest time that a publisher enters, if at all
 *   earliestSubscriberPresent: the earliest time that a subscriber enters, if at all
 *   earliestBothPresent: the earliest time that both a publisher and a subscriber are present, if at all
 * }
 */
async function processDelivery(client, {id, start, end}) {
	return new Promise((resolve, reject) => {
		let startDate, endDate;
		try {
			startDate = new Date(start);
			endDate = new Date(end);
		} catch(err) {
			reject(`Unable to parse given date time bounds: ${err}`);
			return;
		}
		if(startDate >= endDate) {
			reject(`Incompatible time bounds given; end is not later than start`);
			return;
		}

		client.channels.get(`tracking:${id}`).presence.history({direction:'forwards'}, (err, {items}) => {
			if(err) {
				reject(`Unable to query presence for delivery: ${err}`);
				return;
			}

			/* iterate through presence history, arrange into time intervals in the various states */
			let publisherPresent = false,
				subscriberPresent = false,
				bothPresent = false;

			let publisherIntervals = [],
				currentPublisherInterval = undefined;

			let subscriberIntervals = [],
				currentSubscriberInterval = undefined;

			let bothIntervals = [],
				currentBothInterval = undefined;

			for(const item of items) {
				const data = JSON.parse(item.data),
					publisherOrSubscriber = data.type,
					presenceAction = item.action,
					timestamp = new Date(item.timestamp);

				console.log(`Processing ${publisherOrSubscriber}; ${presenceAction}`);
				let newPublisherPresence = publisherPresent, newSubscriberPresence = subscriberPresent;
				if(publisherOrSubscriber == 'PUBLISHER') {
					newPublisherPresence = (presenceAction === 'enter' || presenceAction === 'update');
					if(newPublisherPresence !== publisherPresent) {
						if(newPublisherPresence) {
							/* start a new interval */
							currentPublisherInterval = {publisherOrSubscriber, presenceAction, start: timestamp};
						} else {
							/* end the current interval */
							currentPublisherInterval.end = timestamp;
							publisherIntervals.push(currentPublisherInterval);
							currentPublisherInterval = undefined;
						}
						publisherPresent = newPublisherPresence;
					}
				} else { /* SUBSCRIBER */
					newSubscriberPresence = (presenceAction === 'enter' || presenceAction === 'update');
					if(newSubscriberPresence !== subscriberPresent) {
						if(newSubscriberPresence) {
							/* start a new interval */
							currentSubscriberInterval = {publisherOrSubscriber, presenceAction, start: timestamp};
						} else {
							/* end the current interval */
							currentSubscriberInterval.end = timestamp;
							subscriberIntervals.push(currentSubscriberInterval);
							currentSubscriberInterval = undefined;
						}
						subscriberPresent = newSubscriberPresence;
					}
				}
				const newBothPresence = newPublisherPresence && newSubscriberPresence;
				if(newBothPresence !== bothPresent) {
					if(newBothPresence) {
						/* start a new interval */
						currentBothInterval = {publisherOrSubscriber:'BOTH', presenceAction, start: timestamp};
					} else {
						/* end the current interval */
						currentBothInterval.end = timestamp;
						bothIntervals.push(currentBothInterval);
						currentBothInterval = undefined;
					}
					bothPresent = newBothPresence;
				}
			}

			/* truncate intervals so they fit within the delivery time bounds */
			const truncateIntervals = (intervals) => {
				const result = [];
				intervals.forEach((interval) => {
					if(interval.start >= endDate || interval.end <= startDate) {
						/* discard this interval */
						console.log('discarding interval', interval);
						return;
					}
					if(interval.start < startDate) {
						console.log('truncating interval start', interval);
						interval.start = startDate;
					}
					if(interval.end > endDate) {
						console.log('truncating interval end', interval);
						interval.end = endDate;
					}
					result.push(interval);
				});
				return result;
			}
			publisherIntervals = truncateIntervals(publisherIntervals);
			subscriberIntervals = truncateIntervals(subscriberIntervals);
			bothIntervals = truncateIntervals(bothIntervals);

			/* calculate aggregate presence stats */
			const durationMillis = endDate.getTime() - startDate.getTime();
			let publisherPresentMillis = 0,
				publisherPresentPercent = 0,
				earliestPublisherPresent = 0,
				subscriberPresentMillis = 0,
				subscriberPresentPercent = 0,
				earliestSubscriberPresent = 0,
				bothPresentMillis = 0,
				bothPresentPercent = 0,
				earliestBothPresent = 0;

			publisherIntervals.forEach((interval) => {
				publisherPresentMillis += (interval.end.getTime() - interval.start.getTime());
				if(earliestPublisherPresent === 0) {
					earliestPublisherPresent = interval.start;
				}
			});
			publisherPresentPercent = publisherPresentMillis / durationMillis * 100;

			subscriberIntervals.forEach((interval) => {
				subscriberPresentMillis += (interval.end.getTime() - interval.start.getTime());
				if(earliestSubscriberPresent === 0) {
					earliestSubscriberPresent = interval.start;
				}
			});
			subscriberPresentPercent = subscriberPresentMillis / durationMillis * 100;

			bothIntervals.forEach((interval) => {
				bothPresentMillis += (interval.end.getTime() - interval.start.getTime());
				if(earliestBothPresent === 0) {
					earliestBothPresent = interval.start;
				}
			});
			bothPresentPercent = bothPresentMillis / durationMillis * 100;

			resolve({
				durationMillis,
				publisherPresentMillis,
				publisherPresentPercent,
				earliestPublisherPresent,
				subscriberPresentMillis,
				subscriberPresentPercent,
				earliestSubscriberPresent,
				bothPresentMillis,
				bothPresentPercent,
				earliestBothPresent
			});
		});
	});
}

async function main() {
	/**
	 * expect commandline of the form
	 * aat-tracking-history trackableId, start, end
	 */
	if(process.argv.length !== 5) {
		console.error('aat-tracking-history: invalid arguments');
		console.error('usage: aat-tracking-history trackableId, start, end');
		process.exit(1);
	}

	const histories = await processDeliveries([{id: process.argv[2], start: process.argv[3], end: process.argv[4]}]);
	console.log(inspect(histories));
}

main();
