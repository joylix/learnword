import React from 'react';

const LEGEND_ITEMS = [
  { level: 1, label: '已掌握', className: '' },
  { level: 3, label: '基本认识', className: 'bg-green-200 dark:bg-green-800' },
  { level: 5, label: '有些陌生', className: 'bg-yellow-200 dark:bg-yellow-700' },
  { level: 7, label: '比较陌生', className: 'bg-orange-200 dark:bg-orange-700' },
  { level: 9, label: '完全不认识', className: 'bg-red-200 dark:bg-red-800' },
];

export default function ColorLegend() {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-3">
      <h4 className="text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">颜色图例</h4>
      <div className="space-y-1.5">
        {LEGEND_ITEMS.map((item) => (
          <div key={item.level} className="flex items-center gap-2 text-xs">
            <span className={`inline-block w-6 h-4 rounded ${item.className}`} />
            <span className="text-gray-600 dark:text-gray-400">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
