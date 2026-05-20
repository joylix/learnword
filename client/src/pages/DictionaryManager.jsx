import React, { useState, useEffect, useCallback } from 'react';
import api from '../api';
import ConfirmDialog from '../components/ConfirmDialog';

export default function DictionaryManager() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState('');
  const [editing, setEditing] = useState(null); // null | { ... } for edit | 'new' for create
  const [form, setForm] = useState({});
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const limit = 30;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      let url = `/dictionary/search?page=${page}&limit=${limit}`;
      if (search) url += `&q=${encodeURIComponent(search)}`;
      if (levelFilter) url += `&level=${levelFilter}`;
      const data = await api.get(url);
      const result = data?.data || data || { items: [], total: 0 };
      setItems(result.items || []);
      setTotal(result.total || 0);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [page, search, levelFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
  };

  const startCreate = () => {
    setEditing('new');
    setForm({
      lemma: '', pos: '', translation: '',
      phonetic_us: '', phonetic_uk: '',
      standard_level: 5, collocations: '', example_sentences: ''
    });
  };

  const startEdit = (item) => {
    setEditing(item.word_id);
    setForm({ ...item });
  };

  const cancelEdit = () => {
    setEditing(null);
    setForm({});
  };

  const handleFormChange = (key, value) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    if (!form.lemma?.trim()) {
      setError('lemma is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editing === 'new') {
        await api.post('/dictionary', {
          ...form,
          standard_level: parseInt(form.standard_level, 10) || 5,
        });
      } else {
        await api.put(`/dictionary/${editing}`, {
          ...form,
          standard_level: parseInt(form.standard_level, 10) || 5,
        });
      }
      setEditing(null);
      setForm({});
      loadData();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (wordId) => {
    try {
      await api.delete(`/dictionary/${wordId}`);
      setDeleteConfirm(null);
      loadData();
    } catch (e) {
      setError(e.message);
    }
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">词典管理</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            共 {total} 条词条
          </p>
        </div>
        <button
          onClick={startCreate}
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm"
        >
          + 添加词条
        </button>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Search & Filter */}
      <form onSubmit={handleSearch} className="flex gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索词汇..."
          className="flex-1 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800"
        />
        <select
          value={levelFilter}
          onChange={(e) => { setLevelFilter(e.target.value); setPage(1); }}
          className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800"
        >
          <option value="">全部等级</option>
          {[1,2,3,4,5,6,7,8,9,10].map(l => (
            <option key={l} value={l}>Level {l}</option>
          ))}
        </select>
        <button type="submit" className="px-4 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600">
          搜索
        </button>
      </form>

      {/* Edit/Create Form */}
      {editing && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-lg font-semibold mb-4">
            {editing === 'new' ? '添加词条' : `编辑词条: ${form.lemma || editing}`}
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Lemma *</label>
              <input
                type="text"
                value={form.lemma || ''}
                onChange={(e) => handleFormChange('lemma', e.target.value)}
                className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">词性 (POS)</label>
              <input
                type="text"
                value={form.pos || ''}
                onChange={(e) => handleFormChange('pos', e.target.value)}
                placeholder="n, v, adj, adv..."
                className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">释义</label>
              <input
                type="text"
                value={form.translation || ''}
                onChange={(e) => handleFormChange('translation', e.target.value)}
                className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">美式音标</label>
              <input
                type="text"
                value={form.phonetic_us || ''}
                onChange={(e) => handleFormChange('phonetic_us', e.target.value)}
                className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">英式音标</label>
              <input
                type="text"
                value={form.phonetic_uk || ''}
                onChange={(e) => handleFormChange('phonetic_uk', e.target.value)}
                className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">标准等级 (1-10) *</label>
              <input
                type="number"
                min="1"
                max="10"
                value={form.standard_level || 5}
                onChange={(e) => handleFormChange('standard_level', e.target.value)}
                className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Word ID</label>
              <input
                type="text"
                value={form.word_id || ''}
                onChange={(e) => handleFormChange('word_id', e.target.value)}
                placeholder="留空则使用 lemma"
                className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                disabled={editing !== 'new'}
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">常见搭配 (逗号分隔)</label>
              <input
                type="text"
                value={form.collocations || ''}
                onChange={(e) => handleFormChange('collocations', e.target.value)}
                className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">例句 (逗号分隔)</label>
              <textarea
                value={form.example_sentences || ''}
                onChange={(e) => handleFormChange('example_sentences', e.target.value)}
                rows={2}
                className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
              />
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm disabled:opacity-50"
            >
              {saving ? '保存中...' : '保存'}
            </button>
            <button
              onClick={cancelEdit}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-sm"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          暂无词条
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="text-left p-3 text-sm font-medium text-gray-500 dark:text-gray-400">Word ID</th>
                <th className="text-left p-3 text-sm font-medium text-gray-500 dark:text-gray-400">Lemma</th>
                <th className="text-left p-3 text-sm font-medium text-gray-500 dark:text-gray-400">POS</th>
                <th className="text-left p-3 text-sm font-medium text-gray-500 dark:text-gray-400">释义</th>
                <th className="text-left p-3 text-sm font-medium text-gray-500 dark:text-gray-400">等级</th>
                <th className="text-left p-3 text-sm font-medium text-gray-500 dark:text-gray-400">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.word_id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="p-3 text-sm font-mono text-gray-500">{item.word_id}</td>
                  <td className="p-3 font-medium">{item.lemma}</td>
                  <td className="p-3 text-sm text-gray-500">{item.pos || '-'}</td>
                  <td className="p-3 text-sm text-gray-600 dark:text-gray-400 max-w-xs truncate">{item.translation || '-'}</td>
                  <td className="p-3">
                    <span className="text-xs px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">
                      L{item.standard_level}
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => startEdit(item)}
                        className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(item)}
                        className="text-sm text-red-500 hover:text-red-700"
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-50 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            上一页
          </button>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            第 {page} / {totalPages} 页
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-50 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            下一页
          </button>
        </div>
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteConfirm}
        title="删除词条"
        message={`确定要删除词条 "${deleteConfirm?.lemma}" (${deleteConfirm?.word_id}) 吗？`}
        confirmText="删除"
        cancelText="取消"
        danger
        onConfirm={() => handleDelete(deleteConfirm?.word_id)}
        onCancel={() => setDeleteConfirm(null)}
      />
    </div>
  );
}
