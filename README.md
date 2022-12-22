# Ably Asset Tracking - History analysis

This is a simple utility to process presence history for a given trackable ID and calculate statistics.

## Installation

Clone the repo and `cd` into it.

Run `npm install && npm link`.

## Usage

Run with a valid Ably API key, with hiatory rights, in the environment variable `ABLY_API_KEY`.

Run `aat-tracking-history <trackable-id> <start time> <end time>`

where:

- `<trackable-id>` is the trackable id;
- `<start time>` is the start of the tinme interval to analyse (typically the start of the delivery), specified as an ISO date/time string;
- `<end time>` is the end of the tinme interval to analyse (typically the start of the delivery), specified as an ISO date/time string.
