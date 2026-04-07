CREATE UNIQUE INDEX `memory_edge_account_from_to_relation_uq`
  ON `memory_edge`(`account_id`, `from_id`, `to_id`, `relation`);
