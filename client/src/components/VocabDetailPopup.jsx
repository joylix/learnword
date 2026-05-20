import React, { useState, useEffect, useCallback } from 'react';
import { Howl } from 'howler';
import api from '../api';

export default function VocabDetailPopup({ token, wordId, lemma, onClose, onStrangenessChange }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchDetail = useCallback(async () => {
    if (!wordId && !lemma) return;
    setLoading(true);
    setError(null);
    try {
      const id = wordId || lemma;
      const data = await api.get(`/dictionary/${id}`);
      setDetail(data?.data || data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [wordId, lemma]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  const playAudio = useCallback((phonetic) => {
    if (!phonetic) return;
    const sound = new Howl({
      src: [`/api/audio/en-us/${phonetic[0]}/${lemma || wordId}.mp3`],
      html5: true,
      onloaderror: () => {
        // 静默处理音频加载失败
      }
    });
    sound.play();
  }, [lemma, wordId]);

  const handleStrangenessChange = useCallback(async (direction) => {
    if (!wordId) return;
    try {
      const result = await api.put(`/vocab/${wordId}/strangeness`, { direction });
      onStrangenessChange && onStrangenessChange(result);
      fetchDetail();
    } catch (err) {
      // 错误已在拦截器处理
    }
  }, [wordId, onStrangenessChange, fetchDetail]);

  if (!token) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-lg w-full max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold">{token.text}</h3>
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              ✕
            </button>
          </div>

          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
            </div>
          )}

          {error && (
            <div className="text-red-500 text-center py-4">{error}</div>
          )}

          {detail && !loading && (
            <div className="space-y-4">
              {/* 音标和发音 */}
              {(detail.phonetic_us || detail.phonetic_uk) && (
                <div className="flex items-center gap-4">
                  {detail.phonetic_us && (
                    <button
                      onClick={() => playAudio(detail.phonetic_us)}
                      className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      🔊 美 [{detail.phonetic_us}]
                    </button>
                  )}
                  {detail.phonetic_uk && (
                    <button
                      onClick={() => playAudio(detail.phonetic_uk)}
                      className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      🔊 英 [{detail.phonetic_uk}]
                    </button>
                  )}
                </div>
              )}

              {/* 释义 */}
              {detail.translation && (
                <div>
                  <label className="text-sm text-gray-500 dark:text-gray-400">释义</label>
                  <p className="mt-1">{detail.translation}</p>
                </div>
              )}

              {/* 词性 */}
              {detail.pos && (
                <div>
                  <label className="text-sm text-gray-500 dark:text-gray-400">词性</label>
                  <p className="mt-1">{detail.pos}</p>
                </div>
              )}

              {/* 标准等级 */}
              {detail.standard_level && (
                <div>
                  <label className="text-sm text-gray-500 dark:text-gray-400">标准等级</label>
                  <p className="mt-1">{detail.standard_level}</p>
                </div>
              )}

              {/* 搭配 */}
              {detail.collocations && (
                <div>
                  <label className="text-sm text-gray-500 dark:text-gray-400">常见搭配</label>
                  <p className="mt-1 text-sm">
                    {Array.isArray(detail.collocations)
                      ? detail.collocations.join(', ')
                      : detail.collocations}
                  </p>
                </div>
              )}

              {/* 例句 */}
              {detail.example_sentences && (
                <div>
                  <label className="text-sm text-gray-500 dark:text-gray-400">例句</label>
                  <ul className="mt-1 space-y-1 text-sm">
                    {Array.isArray(detail.example_sentences)
                      ? detail.example_sentences.map((s, i) => <li key={i}>• {s}</li>)
                      : <li>• {detail.example_sentences}</li>}
                  </ul>
                </div>
              )}

              {/* 陌生度操作 */}
              {token.strangeness && (
                <div className="flex items-center gap-3 pt-2 border-t border-gray-200 dark:border-gray-700">
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    当前陌生度: <strong>{token.strangeness}</strong>
                  </span>
                  <div className="flex gap-2 ml-auto">
                    <button
                      onClick={() => handleStrangenessChange('down')}
                      disabled={token.strangeness <= 1}
                      className="px-3 py-1 text-sm bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded-lg hover:bg-green-200 dark:hover:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      降低难度 ↓
                    </button>
                    <button
                      onClick={() => handleStrangenessChange('up')}
                      disabled={token.strangeness >= 9}
                      className="px-3 py-1 text-sm bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 rounded-lg hover:bg-red-200 dark:hover:bg-red-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      提高难度 ↑
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
