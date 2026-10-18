<?php
$process = proc_open(
    ['telegram-rich-blocks', 'send', '--chat', getenv('TELEGRAM_CHAT_ID'), '-'],
    [0 => ['pipe', 'r'], 1 => STDOUT, 2 => STDERR],
    $pipes
);
if (!is_resource($process)) {
    exit(2);
}
fwrite($pipes[0], "# Job complete\n\n- Status: **ready**\n");
fclose($pipes[0]);
exit(proc_close($process));
