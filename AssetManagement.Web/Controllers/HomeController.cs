using AssetManagement.Core.Commands;
using AssetManagement.Core.Enums;
using AssetManagement.Core.Models;
using AssetManagement.Core.Queries;
using MediatR;
using Microsoft.AspNetCore.Mvc;

namespace AssetManagement.Web.Controllers;

public class HomeController : Controller
{
    private readonly IMediator _mediator;

    public HomeController(IMediator mediator) => _mediator = mediator;

    public async Task<IActionResult> Index(int pageIndex = 1, int pageSize = 10, CancellationToken cancellationToken = default)
    {
        var result = await _mediator.Send(new GetPagedAssetStatusByTenantQuery(pageIndex, pageSize), cancellationToken);
        return View(result);
    }

    public async Task<IActionResult> Details(
        Guid tenantId,
        int pageIndex = 1,
        int pageSize = 20,
        CancellationToken cancellationToken = default)
    {
        var tenants = await _mediator.Send(new GetAllTenantsQuery(), cancellationToken);
        var tenant = tenants.FirstOrDefault(t => t.Id == tenantId);
        if (tenant == null)
        {
            return NotFound();
        }

        var assets = await _mediator.Send(new GetPagedTenantAssetsQuery(tenantId, pageIndex, pageSize), cancellationToken);

        ViewBag.Tenant = tenant;
        return View(assets);
    }

    public async Task<IActionResult> Edit(Guid id, CancellationToken cancellationToken = default)
    {
        var asset = await _mediator.Send(new GetAssetByIdQuery(id), cancellationToken);
        if (asset == null)
        {
            return NotFound();
        }

        return View(new EditAssetStatusViewModel
        {
            AssetId = asset.AssetId,
            AssetName = asset.AssetName,
            AssetType = asset.AssetType,
            CurrentStatus = asset.Status,
            NewStatus = asset.Status,
            UpdatedBy = asset.UpdatedBy
        });
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Edit(EditAssetStatusViewModel model, CancellationToken cancellationToken = default)
    {
        if (!ModelState.IsValid)
        {
            return View(model);
        }

        try
        {
            await _mediator.Send(
                new UpdateAssetStatusCommand(new UpdateAssetStatusRequest
                {
                    AssetId = model.AssetId,
                    NewStatus = model.NewStatus,
                    UpdatedBy = model.UpdatedBy
                }),
                cancellationToken);

            TempData["Success"] = "Статус активу оновлено.";
            return RedirectToAction(nameof(Index));
        }
        catch (KeyNotFoundException)
        {
            return NotFound();
        }
    }

    public IActionResult Error() => View();
}

public class EditAssetStatusViewModel
{
    public Guid AssetId { get; set; }
    public string AssetName { get; set; } = string.Empty;
    public string AssetType { get; set; } = string.Empty;
    public AssetStatus CurrentStatus { get; set; }
    public AssetStatus NewStatus { get; set; }
    public string UpdatedBy { get; set; } = string.Empty;
}
