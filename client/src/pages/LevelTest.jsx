import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

export default function LevelTest() {
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [text, setText] = useState(null);
  const [level, setLevel] = useState(null);
  const [asked, setAsked] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [finalLevel, setFinalLevel] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const startTest = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.post('/level-test/start');
      const result = data?.data || data;
      setSession(result.sessionId);
      setLevel(result.level);
      setText(result.text);
      setAsked(0);
      setCompleted(false);
      setCancelled(false);
      setFinalLevel(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const submitFeedback = async (feedback) => {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.post('/level-test/feedback', {
        sessionId: session,
        level,
        feedback,
      });
      const result = data?.data || data;

      if (result.completed) {
        setCompleted(true);
        setCancelled(result.cancelled || false);
        setFinalLevel(result.finalLevel);
        setText(null);
      } else {
        setLevel(result.nextLevel);
        setText(result.text);
        setAsked(result.asked || asked + 1);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // 测评完成
  if (completed) {
    if (cancelled) {
      return (
        <div className="max-w-lg mx-auto text-center py-12">
          <div className="text-5xl mb-4">🔄</div>
          <h1 className="text-2xl font-bold mb-2">测评已取消</h1>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            您可以随时重新开始测评。当前默认等级为 <strong>Level 4</strong>。
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => navigate('/level-test')}
              className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
            >
              重新测评
            </button>
            <button
              onClick={() => navigate('/')}
              className="px-6 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              返回首页
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="max-w-lg mx-auto text-center py-12">
        <div className="text-5xl mb-4">🎉</div>
        <h1 className="text-2xl font-bold mb-2">测评完成！</h1>
        <p className="text-gray-600 dark:text-gray-400 mb-2">
          根据您的反馈，系统评估您的英语水平为
        </p>
        <p className="text-4xl font-bold text-blue-600 dark:text-blue-400 mb-6">
          Level {finalLevel}
        </p>
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 mb-6 text-sm text-blue-700 dark:text-blue-300">
          <p>📖 测评文章等级: <strong>Level {finalLevel}</strong></p>
          <p className="mt-1">系统将根据您的等级自动标注文章中的词汇难度。</p>
          <p className="mt-1">随着您掌握更多词汇，等级会自动提升。</p>
        </div>
        <div className="flex gap-3 justify-center">
          <button
            onClick={() => navigate('/articles/new')}
            className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            开始导入文章
          </button>
          <button
            onClick={() => navigate('/')}
            className="px-6 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            返回首页
          </button>
        </div>
      </div>
    );
  }

  // 未开始测评
  if (!session) {
    return (
      <div className="max-w-lg mx-auto text-center py-12">
        <h1 className="text-2xl font-bold mb-4">英语水平测评</h1>
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          系统会从 <strong>Level 4</strong> 的文章开始，根据您的反馈自动调整难度。
        </p>
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 mb-6 text-sm text-left">
          <p className="font-medium mb-2">测评说明：</p>
          <ul className="space-y-1 text-gray-600 dark:text-gray-400">
            <li>• 阅读文章后选择"太难"或"太简单"</li>
            <li>• 如果文章难度刚好，选择"确认当前等级"</li>
            <li>• 测评完成后可随时重新测评</li>
          </ul>
        </div>
        <button
          onClick={startTest}
          disabled={loading}
          className="px-8 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
        >
          {loading ? '加载中...' : '开始测评'}
        </button>
        {error && <p className="text-red-500 mt-4">{error}</p>}
      </div>
    );
  }

  // 测评进行中
  return (
    <div className="max-w-2xl mx-auto">
      {/* 顶部信息栏 */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">水平测评</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            第 {asked + 1} 题
          </span>
          <span className="px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-sm font-medium">
            Level {level}
          </span>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-3 rounded-lg mb-4">
          {error}
        </div>
      )}

      {/* 文章区域 */}
      {text && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">{text.title}</h2>
            <span className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded text-gray-500 dark:text-gray-400">
              等级 {level}
            </span>
          </div>
          <div className="prose dark:prose-invert max-w-none leading-relaxed whitespace-pre-wrap text-base">
            {text.content}
          </div>
        </div>
      )}

      {/* 操作按钮 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
        <p className="text-center text-gray-600 dark:text-gray-400 mb-4 text-sm">
          这篇文章的难度如何？
        </p>
        <div className="flex flex-wrap gap-3 justify-center">
          <button
            onClick={() => submitFeedback('hard')}
            disabled={loading}
            className="px-5 py-2.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors disabled:opacity-50"
          >
            ⬇️ 降低难度
          </button>
          <button
            onClick={() => submitFeedback('confirm')}
            disabled={loading}
            className="px-5 py-2.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-lg hover:bg-green-200 dark:hover:bg-green-800 transition-colors disabled:opacity-50 font-medium"
          >
            ✅ 确认当前等级
          </button>
          <button
            onClick={() => submitFeedback('easy')}
            disabled={loading}
            className="px-5 py-2.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-lg hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors disabled:opacity-50"
          >
            ⬆️ 升高难度
          </button>
        </div>
        <div className="flex justify-center gap-3 mt-3">
          <button
            onClick={() => submitFeedback('skip')}
            disabled={loading}
            className="px-4 py-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
          >
            跳过测评 (默认 Level 4)
          </button>
          <button
            onClick={() => submitFeedback('cancel')}
            disabled={loading}
            className="px-4 py-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
          >
            取消测评
          </button>
        </div>
      </div>
    </div>
  );
}
