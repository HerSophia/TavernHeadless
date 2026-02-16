ALTER TABLE `session` ADD `prompt_mode` text CHECK(`prompt_mode` IN ('compat_strict', 'compat_plus', 'native'));
