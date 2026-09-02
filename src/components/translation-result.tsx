"use client";

import { useId, useState } from "react";
import { toRomaji } from "wanakana";
import { CheckCircle, MagnifyingGlass, SpeakerHigh } from "@phosphor-icons/react";
import type { SearchSuggestion, TranslationResult } from "@/lib/types";
import { isKatakanaWord, katakanaPresentation, titleLengthClass } from "@/lib/language/katakana";
import { useRomajiPreference } from "./use-romaji-preference";

function alternativeQuery(label: string) {
  return label.split(/[·；;]/u)[0].replace(/（[^）]*）|\([^)]*\)/gu, "").trim();
}

function speakJapaneseLocally(text: string, onStatus: (message: string) => void) {
  if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
    onStatus("当前浏览器不支持本地语音。");
    return;
  }
  const synth = window.speechSynthesis;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ja-JP";
  utterance.rate = 0.84;
  utterance.pitch = 1;
  utterance.volume = 1;
  const japaneseVoice = synth.getVoices().find((voice) => /^ja(?:-|_)/iu.test(voice.lang));
  if (japaneseVoice) utterance.voice = japaneseVoice;
  utterance.onstart = () => onStatus("正在播放本地日语发音…");
  utterance.onend = () => onStatus("已播放本地日语发音。");
  utterance.onerror = () => onStatus("本地语音播放失败，请检查浏览器声音权限。");
  synth.cancel();
  synth.resume();
  window.setTimeout(() => synth.speak(utterance), 0);
}

export function TranslationResultView({
  result,
  streaming = false,
  isFollowUp = false,
  onSelectSuggestion,
}: {
  result: Partial<TranslationResult>;
  streaming?: boolean;
  isFollowUp?: boolean;
  onSelectSuggestion?: (query: string) => void;
}) {
  const [showKana, setShowKana] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [speechStatus, setSpeechStatus] = useState("");
  const sentence = result.sentenceAnalysis;
  const entry = sentence ? undefined : result.dictionary;
  const [showRomaji, toggleRomaji] = useRomajiPreference();
  const romajiId = useId();
  const surface = entry && isKatakanaWord(result.original ?? "") ? result.original! : entry?.surface || result.translation || "…";
  const reading = entry?.reading || sentence?.reading || (/^[ぁ-ゖァ-ヶー\s]+$/u.test(surface) ? surface : undefined);
  const romaji = entry?.romaji || sentence?.romaji || (reading ? toRomaji(reading) : undefined);
  const katakana = !sentence && (entry || result.katakanaInfo || result.katakanaOrigin) ? katakanaPresentation(result) : undefined;
  const meanings = Array.isArray(result.meanings) ? result.meanings : [];
  const examples = Array.isArray(result.examples) ? result.examples : [];
  const usageNotes = Array.isArray(result.usageNotes) ? result.usageNotes : [];
  const alternatives = Array.isArray(result.alternatives) ? result.alternatives : [];
  const sentenceTokens = Array.isArray(sentence?.tokens) ? sentence.tokens : [];
  const sentenceVariants = Array.isArray(sentence?.variants) ? sentence.variants : [];
  const recognitionSegments = Array.isArray(result.recognition?.segments)
    ? result.recognition.segments.filter((segment) => !["space", "punctuation"].includes(segment.kind) && segment.resolved)
    : [];
  const warnings = Array.isArray(result.warnings) ? result.warnings : [];
  const suggestions: SearchSuggestion[] = Array.isArray(result.suggestions) && result.suggestions.length > 0
    ? result.suggestions
    : alternatives.map((label) => ({ label, query: alternativeQuery(label) })).filter((item) => item.query);
  const canContinueAssociating = Boolean(
    onSelectSuggestion
    && suggestions.length > 1
    && (entry || result.correction || result.detectedLanguage === "romaji"),
  );
  const incompleteRomajiLookup = Boolean(
    !streaming
    && !isFollowUp
    && result.detectedLanguage === "romaji"
    && result.translation
    && !entry,
  );

  return (
    <article className="result-document" aria-live="polite" aria-busy={streaming}>
      {streaming && <div className="streaming-line"><span />正在编织自然表达…</div>}
      <header className={`entry-header${sentence && !entry ? " sentence-header" : ""}`}>
        <div className="entry-heading-row">
          {isFollowUp && !entry && !sentence
            ? <p className="followup-answer">{surface}</p>
            : <h1 lang={entry || sentence ? "ja" : undefined} className={`${entry ? "entry-surface" : "translation-main"} ${titleLengthClass(surface)}`}>{surface}</h1>}
          <div className="entry-tools">
            {romaji && <button type="button" className="romaji-toggle" aria-label={showRomaji ? "隐藏罗马字" : "显示罗马字"} aria-pressed={showRomaji} aria-expanded={showRomaji} aria-controls={romajiId} title="罗马字（记住显示偏好）" onClick={toggleRomaji}>Aa</button>}
            {reading && (
            <button
              className={`icon-button listen-button${speechStatus.startsWith("正在") ? " is-speaking" : ""}`}
              type="button"
              aria-label={`播放「${surface}」的本地日语发音`}
              title="使用设备内置日语语音"
              onClick={() => speakJapaneseLocally(surface, setSpeechStatus)}
            ><SpeakerHigh aria-hidden="true" /></button>
            )}
          </div>
        </div>
        <span className="sr-only" aria-live="polite">{speechStatus}</span>
        {entry?.reading && entry.reading !== surface && !katakana && <p className="entry-reading" lang="ja">{entry.reading}</p>}
        {romaji && <p id={romajiId} className="entry-romaji" lang="ja-Latn" hidden={!showRomaji}>{romaji}</p>}
        {katakana ? <>
          {katakana.sourceExpression && <p className="entry-source" aria-label="来源或构成表达">{katakana.sourceExpression}</p>}
          {katakana.naturalEnglish.length > 0 && <div className="entry-definition"><span>自然英语</span><p lang="en">{katakana.naturalEnglish.join(" · ")}</p></div>}
          <div className="entry-definition"><span>中文</span><p lang="zh-Hans">{entry?.chineseMeaning || (streaming ? "正在补充…" : "中文释义未完整返回，可继续追问。")}</p></div>
          {(katakana.label || katakana.sourceLanguage || katakana.formationNote || katakana.usageNote) && <div className="entry-origin-note">
            {(katakana.label || katakana.sourceLanguage) && <small>{[katakana.label, katakana.sourceLanguage].filter(Boolean).join(" · ")}</small>}
            {[...new Set([katakana.formationNote, katakana.usageNote].filter(Boolean))].map((note) => <p key={note}>{note}</p>)}
          </div>}
        </> : <>
          {entry?.englishMeaning && <p className="entry-english">{entry.englishMeaning}</p>}
          {entry?.chineseMeaning && <p className="entry-chinese">{entry.chineseMeaning}</p>}
        </>}
        {entry?.partOfSpeech && <p className="part-of-speech">{entry.partOfSpeech}</p>}
      </header>

      {!sentence && result.recognition?.resolved && recognitionSegments.length > 0 && (
        <section className="input-recognition" aria-label="输入识别结果">
          <span>输入识别</span>
          <div className="recognition-flow">
            <code>{result.recognition.normalized}</code>
            <span aria-hidden="true">→</span>
            <span lang="ja">{recognitionSegments.map((segment) => segment.reading || segment.resolved).join(" + ")}</span>
            <span aria-hidden="true">→</span>
            <strong lang="ja">{result.recognition.resolved}</strong>
          </div>
        </section>
      )}

      {warnings.length > 0 && (
        <div className="result-warnings" role="status">
          {warnings.map((warning) => <p key={warning}>{warning}</p>)}
        </div>
      )}

      {!entry && !sentence && result.naturalTranslation && result.naturalTranslation !== result.translation && (
        <section className="result-section"><h2>自然表达</h2><p className="natural-translation">{result.naturalTranslation}</p></section>
      )}
      {!sentence && result.literalTranslation && <section className="result-section compact"><h2>直译</h2><p>{result.literalTranslation}</p></section>}

      {sentence && (
        <section className="result-section sentence-comparison">
          <h2>中日英对照</h2>
          <dl className="sentence-language-lines">
            <div><dt>日本語</dt><dd lang="ja">{sentence.japanese}</dd></div>
            {sentence.reading && <div><dt>かな</dt><dd lang="ja">{sentence.reading}</dd></div>}
            {sentence.chinese && <div><dt>中文</dt><dd lang="zh-Hans">{sentence.chinese}</dd></div>}
            {sentence.english && <div><dt>English</dt><dd lang="en">{sentence.english}</dd></div>}
          </dl>
        </section>
      )}

      {sentenceTokens.length > 0 && (
        <section className="result-section sentence-breakdown">
          <h2>分词与读音</h2>
          <div className="sentence-tokens">
            {sentenceTokens.map((token, index) => (
              <div className="sentence-token" key={`${token.surface}-${index}`}>
                <strong lang="ja">{token.surface}</strong>
                {token.reading && <span lang="ja">{token.reading}</span>}
                {showRomaji && token.romaji && <span className="token-romaji" lang="ja-Latn">{token.romaji}</span>}
                {token.meaning && <small>{token.meaning}</small>}
              </div>
            ))}
          </div>
        </section>
      )}

      {sentenceVariants.length > 0 && (
        <section className="result-section sentence-variants">
          <h2>不同语境怎么说</h2>
          <div className="variant-list">
            {sentenceVariants.map((variant, index) => (
              <div className="variant-row" key={`${variant.label}-${variant.japanese}-${index}`}>
                <div className="variant-label">{variant.label}</div>
                <div className="variant-content">
                  <strong lang="ja">{variant.japanese}</strong>
                  {(variant.reading || (showRomaji && variant.romaji)) && (
                    <p className="variant-reading">
                      {variant.reading && <span lang="ja">{variant.reading}</span>}
                      {showRomaji && variant.reading && variant.romaji && <span aria-hidden="true"> · </span>}
                      {showRomaji && variant.romaji && <span lang="ja-Latn">{variant.romaji}</span>}
                    </p>
                  )}
                  {(variant.chinese || variant.english) && (
                    <p className="variant-meaning">
                      {variant.chinese && <span lang="zh-Hans">{variant.chinese}</span>}
                      {variant.english && <span lang="en">{variant.english}</span>}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {incompleteRomajiLookup && (
        <section className="result-section incomplete-result-note">
          <h2>词义尚未完整返回</h2>
          <p>当前只确认到了日语候选，AI Provider 没有返回中文和英文释义。可以继续联想其他相似发音，或重新查询。</p>
        </section>
      )}

      {result.correction && (
        <div className="correction-note"><CheckCircle aria-hidden="true" /><div><strong>已理解为 {result.correction.normalized}</strong>{result.correction.note && <span>{result.correction.note}</span>}</div></div>
      )}

      {meanings.length > 0 && (
        <section className="result-section">
          <h2>常见用法</h2>
          <div className="meaning-list">
            {meanings.map((meaning, index) => (
              <div className="meaning-row" key={`${meaning.pattern}-${index}`}>
                <span className="meaning-number">{index + 1}</span>
                <div><strong>{meaning.pattern || meaning.japanese || meaning.label}</strong><p>{meaning.chinese}{meaning.english && <span className="meaning-english">{meaning.english}</span>}</p></div>
              </div>
            ))}
          </div>
        </section>
      )}

      {examples.length > 0 && (
        <section className="result-section examples-section">
          <div className="section-title-row">
            <h2>例句</h2>
            <label className="switch-label"><input type="checkbox" checked={showKana} onChange={(event) => setShowKana(event.target.checked)} /> <span>假名辅助</span></label>
          </div>
          <div className="example-list">
            {examples.map((example, index) => (
              <div className="example" key={`${example.japanese}-${index}`}>
                {example.japanese && <p className="example-japanese">{example.japanese}</p>}
                {showKana && example.reading && <p className="example-reading">{example.reading}</p>}
                {example.chinese && <p>{example.chinese}</p>}
                {example.english && <p className="example-english">{example.english}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {usageNotes.length > 0 && (
        <section className="result-section notes-section"><h2>语言提示</h2><ul>{usageNotes.map((note) => <li key={note}>{note}</li>)}</ul></section>
      )}
      {canContinueAssociating && !showSuggestions && (
        <section className="result-section suggestion-prompt">
          <button type="button" onClick={() => setShowSuggestions(true)}>
            <MagnifyingGlass aria-hidden="true" />结果不对？查看其他相似候选
          </button>
        </section>
      )}
      {canContinueAssociating && showSuggestions && (
        <section className="result-section suggestion-section">
          <h2>相似发音候选</h2>
          <div className="suggestion-candidates">
            {suggestions.map((suggestion, index) => (
              <button type="button" key={`${suggestion.query}-${index}`} onClick={() => onSelectSuggestion?.(suggestion.query)}>
                <strong>{suggestion.label}</strong>
                {suggestion.reading && <span>{suggestion.reading}</span>}
              </button>
            ))}
          </div>
        </section>
      )}
      {!canContinueAssociating && alternatives.length > 0 && (
        <section className="result-section alternatives"><h2>可能还想找</h2><p>{alternatives.join(" · ")}</p></section>
      )}
    </article>
  );
}
