import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api';
import { renderTokens } from '../utils/tokenRenderer';
import VocabDetailPopup from '../components/VocabDetailPopup';
import ColorLegend from '../components/ColorLegend';

// 陌生度颜色配置
const STRANGENESS_CONFIG = {
  1: { label: '已掌握', color: 'bg-gray-300 dark:bg-gray-600', textColor: 'text-gray-700 dark:text-gray-300', dot: 'bg-gray-400' },
  3: { label: '基本认识', color: 'bg-green-200 dark:bg-green-800', textColor: 'text-green-700 dark:text-green-300', dot: 'bg-green-500' },
  5: { label: '有些陌生', color: 'bg-yellow-200 dark:bg-yellow-700', textColor: 'text-yellow-700 dark:text-yellow-300', dot: 'bg-yellow-500' },
  7: { label: '比较陌生', color: 'bg-orange-200 dark:bg-orange-700', textColor: 'text-orange-700 dark:text-orange-300', dot: 'bg-orange-500' },
  9: { label: '完全不认识', color: 'bg-red-200 dark:bg-red-800', textColor: 'text-red-700 dark:text-red-300', dot: 'bg-red-500' },
};

export default function Reading() {
  const { articleId } = useParams();
  const navigate = useNavigate();
  const [article, setArticle] = useState(null);
  const [tokens, setTokens] = useState([]);
  const [annotations, setAnnotations] = useState([]);
  const [selectedToken, setSelectedToken] = useState(null);
  const [showVocabPopup, setShowVocabPopup] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // 划选标注陌生度
  const [selectionMenu, setSelectionMenu] = useState(null);
  const articleRef = useRef(null);

  const loadArticle = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get(`/articles/${articleId}`);
      const result = data?.data || data;
      setArticle(result);
      setTokens(result.tokenized || []);
      setAnnotations(result.annotations || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [articleId]);

  useEffect(() => {
    loadArticle();
  }, [loadArticle]);

  // 统计各陌生度的词汇数量（按唯一 word_id 去重）
  const strangenessCounts = React.useMemo(() => {
    const counts = { 1: 0, 3: 0, 5: 0, 7: 0, 9: 0 };
    const seen = new Set();
    for (const t of tokens) {
      if (t.is_word && t.word_id && !seen.has(t.word_id)) {
        seen.add(t.word_id);
        const s = t.strangeness;
        if (counts[s] !== undefined) counts[s]++;
      }
    }
    return counts;
  }, [tokens]);

  const handleTokenClick = useCallback((token) => {
    if (token.is_word) {
      setSelectedToken(token);
      setShowVocabPopup(true);
    }
  }, []);

  const handleStrangenessChange = useCallback(() => {
    loadArticle();
  }, [loadArticle]);
  // 鼠标划选处理
  const handleMouseUp = useCallback((e) => {
    if (e.target.closest('[data-selection-menu]')) return;

    const selection = window.getSelection();
    if (selection.isCollapsed) {
      setSelectionMenu(null);
      return;
    }

    const range = selection.getRangeAt(0);
    const articleEl = articleRef.current;
    if (!articleEl || !articleEl.contains(range.commonAncestorContainer)) {
      setSelectionMenu(null);
      return;
    }

    const rawText = selection.toString();
    if (!rawText || rawText.trim().length === 0) {
      setSelectionMenu(null);
      return;
    }

    // 计算选区在文章中的字符偏移
    // 方法：用 Range 创建标记，然后计算位置
    let startChar = 0;
    let endChar = 0;

    // 遍历所有文本节点，累加偏移
    const walker = document.createTreeWalker(articleEl, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node === range.startContainer) {
        startChar += range.startOffset;
      }
      if (node === range.endContainer) {
        endChar = startChar + range.endOffset - range.startOffset;
        break;
      }
      if (!startChar && node !== range.startContainer) {
        // 还没找到 startContainer，继续累加
      }
    }

    // 如果 endChar 没计算出来（异常情况），用文本长度估算
    if (endChar === 0) {
      endChar = startChar + rawText.length;
    }

    // 扩展选区边界到完整单词
    const articleText = article.content;

    // 向前扩展：如果 startChar 前面是字母，向前扩展到单词开头
    while (startChar > 0 && /[a-zA-Z]/.test(articleText[startChar - 1])) {
      startChar--;
    }
    // 向后扩展：如果 endChar 后面是字母，向后扩展到单词结尾
    while (endChar < articleText.length && /[a-zA-Z]/.test(articleText[endChar])) {
      endChar++;
    }

    const expandedText = articleText.slice(startChar, endChar);
    if (!expandedText || expandedText.trim().length === 0) {
      setSelectionMenu(null);
      return;
    }

    const rect = range.getBoundingClientRect();

    setSelectionMenu({
      x: rect.left + rect.width / 2,
      y: rect.top,
      text: expandedText,
      startChar,
      endChar,
    });
  }, [article.content]);
  // 划选后设置陌生度
  const handleSelectionStrangeness = useCallback(async (strangeness) => {
    if (!selectionMenu) return;

    const selectedTokens = tokens.filter(t =>
      t.is_word &&
      t.start_char >= selectionMenu.startChar &&
      t.end_char <= selectionMenu.endChar
    );

    // 分离已有 word_id 的词和 OOV 词
    const existingWordIds = [...new Set(selectedTokens.filter(t => t.word_id).map(t => t.word_id))];
    const oovTokens = selectedTokens.filter(t => !t.word_id);

    try {
      // 处理已有词典记录的词
      for (const wordId of existingWordIds) {
        await api.put(`/vocab/${wordId}/set-strangeness`, { strangeness });
      }

      // 处理 OOV 词：先添加到词典，再设置陌生度
      for (const token of oovTokens) {
        const result = await api.post('/dictionary/auto-add', {
          word: token.text,
          strangeness,
        });
        if (result?.data?.word_id) {
          await api.put(`/vocab/${result.data.word_id}/set-strangeness`, { strangeness });
        }
      }

      setSelectionMenu(null);
      loadArticle();
    } catch (e) {
      console.error('Failed to set strangeness:', e);
      setSelectionMenu(null);
    }
  }, [selectionMenu, tokens, loadArticle]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-500 mb-4">{error}</p>
        <button onClick={() => navigate('/articles')} className="text-blue-600 hover:underline">
          返回文章列表
        </button>
      </div>
    );
  }

  return (
    <div className="flex gap-6">
      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="mb-4">
          <button onClick={() => navigate('/articles')} className="text-sm text-blue-600 dark:text-blue-400 hover:underline mb-1">
            ← 返回列表
          </button>
          <h1 className="text-xl font-bold">{article?.title}</h1>
        </div>

        {/* Article content */}
        <div
          ref={articleRef}
          data-article-content
          className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 leading-relaxed text-lg select-text"
          onMouseUp={handleMouseUp}
        >
          {tokens.length > 0 ? (
            <div className="whitespace-pre-wrap">
              {renderTokens(tokens, annotations, handleTokenClick)}
            </div>
          ) : (
            <p className="whitespace-pre-wrap">{article?.content}</p>
          )}
        </div>

        <div className="mt-3 text-xs text-gray-400 dark:text-gray-500">
          💡 点击单词查看详情 | 拖拽选中文字可标注陌生度
        </div>
      </div>

      {/* Sidebar */}
      <div className="w-56 flex-shrink-0 space-y-4">
        <ColorLegend />

        {/* 陌生度统计 */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-3">
          <h4 className="text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">页面词汇统计</h4>
          <div className="space-y-1.5">
            {[9, 7, 5, 3, 1].map(level => (
              <div key={level} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5">
                  <span className={`w-3 h-3 rounded-full ${STRANGENESS_CONFIG[level].dot}`} />
                  <span className="text-gray-600 dark:text-gray-400">{STRANGENESS_CONFIG[level].label}</span>
                </div>
                <span className="font-medium">{strangenessCounts[level] || 0}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Vocab Detail Popup */}
      {showVocabPopup && (
        <VocabDetailPopup
          token={selectedToken}
          wordId={selectedToken?.word_id}
          lemma={selectedToken?.lemma}
          onClose={() => {
            setShowVocabPopup(false);
            setSelectedToken(null);
          }}
          onStrangenessChange={handleStrangenessChange}
        />
      )}

      {/* 划选陌生度菜单 */}
      {selectionMenu && (
        <div
          data-selection-menu
          className="fixed z-50 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 p-2 flex gap-1"
          style={{
            left: Math.min(selectionMenu.x - 120, window.innerWidth - 260),
            top: Math.max(selectionMenu.y - 50, 10),
          }}
        >
          <span className="text-xs text-gray-500 dark:text-gray-400 mr-1 self-center whitespace-nowrap">
            设为:
          </span>
          {[1, 3, 5, 7, 9].map(level => (
            <button
              key={level}
              onClick={() => handleSelectionStrangeness(level)}
              className={`px-2 py-1 text-xs rounded transition-colors ${STRANGENESS_CONFIG[level].color} ${STRANGENESS_CONFIG[level].textColor} hover:opacity-80`}
              title={STRANGENESS_CONFIG[level].label}
            >
              {level}
            </button>
          ))}
          <button
            onClick={() => setSelectionMenu(null)}
            className="px-2 py-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
