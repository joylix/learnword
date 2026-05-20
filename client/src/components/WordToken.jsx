import React, { useCallback } from 'react';

const STRANGENESS_COLORS = {
  1: '',                           // 无样式
  3: 'bg-green-200 dark:bg-green-800',  // 浅绿
  5: 'bg-yellow-200 dark:bg-yellow-700', // 黄色
  7: 'bg-orange-200 dark:bg-orange-700', // 橙色
  9: 'bg-red-200 dark:bg-red-800 underline decoration-red-500 decoration-wavy', // 红色下划线
};

const WordToken = React.memo(function WordToken({ token, hasAnnotation, onClick }) {
  const handleClick = useCallback((e) => {
    e.stopPropagation();
    onClick && onClick(token);
  }, [token, onClick]);

  const colorClass = STRANGENESS_COLORS[token.strangeness] || '';
  const isWord = token.is_word !== false;

  if (!isWord) {
    return <span>{token.text}</span>;
  }

  return (
    <span
      className={`cursor-pointer rounded-sm px-0.5 py-0.5 transition-colors hover:opacity-80 ${colorClass} ${
        hasAnnotation ? 'border-b-2 border-blue-500' : ''
      }`}
      onClick={handleClick}
      title={token.lemma || token.text}
    >
      {token.text}
    </span>
  );
});

export default WordToken;
