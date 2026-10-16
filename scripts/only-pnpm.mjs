/**
 * pnpm 以外のパッケージマネージャによる install をブロックする。
 *
 * NOTE: 定番の `pnpm dlx only-allow pnpm` は使えない。`pnpm dlx` は子プロセスの
 * `npm_config_user_agent` を `pnpm/...` に上書きするため、npm から呼ばれても
 * only-allow は常に "pnpm" を検出し、一度もブロックしない（検証済み）。
 * ここでは preinstall から node を直接起動し、呼び出し元の環境変数をそのまま読む。
 */
const userAgent = process.env.npm_config_user_agent?.trim() ?? "";
const detected = userAgent.split(/[\s/]/, 1)[0];

// preinstall はパッケージマネージャから実行されるため、識別情報が無い場合も許可しない。
if (!detected || detected !== "pnpm") {
  const manager = detected || "判定不能（npm_config_user_agent が未設定または空）";
  console.error(`
╔════════════════════════════════════════════════════════════════╗
║  このリポジトリは pnpm 専用です                                ║
╚════════════════════════════════════════════════════════════════╝

  検出したパッケージマネージャ: ${manager}
  user agent: ${userAgent}

  pnpm 以外の install は package-lock.json / yarn.lock を生成し、
  pnpm-lock.yaml と二重管理になります。その結果 CI の
  --frozen-lockfile と scripts/check-lockfile-sync.sh が無意味になります。

  代わりに以下を実行してください:

      pnpm install
`);
  process.exit(1);
}
