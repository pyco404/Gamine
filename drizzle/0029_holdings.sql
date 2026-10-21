-- Holder agents (docs/holder-agents.md): holding $GAMINE above the minimum is the
-- agent. Nothing is deposited, so a holder agent's balance is not a sum of ledger
-- rows but a reading of its owner's wallet, taken off chain and kept here, one
-- row per wallet, overwritten by each read.
CREATE TABLE "holdings" (
	"wallet" text PRIMARY KEY NOT NULL,
	"amount" bigint NOT NULL,
	"supply" bigint NOT NULL,
	"read_at" timestamp with time zone NOT NULL
);
