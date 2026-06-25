using AssetManagement.Core.Commands;
using AssetManagement.Core.Enums;
using AssetManagement.Core.Handlers;
using AssetManagement.Core.Models;
using AssetManagement.Core.Queries;
using AssetManagement.Infrastructure.Repositories;
using MediatR;
using Microsoft.Extensions.DependencyInjection;

namespace AssetManagement.Tests;

public class GetAssetStatusByTenantQueryHandlerTests
{
    [Fact]
    public async Task Handle_ReturnsAssetsGroupedByTenant()
    {
        var repo = new FakeAssetRepository();
        var handler = new GetAssetStatusByTenantQueryHandler(repo);

        var result = await handler.Handle(new GetAssetStatusByTenantQuery(), CancellationToken.None);

        Assert.Equal(3, result.Count);
        Assert.All(result.Values, assets => Assert.NotEmpty(assets));
    }
}

public class GetPagedAssetStatusByTenantQueryHandlerTests
{
    [Fact]
    public async Task Handle_ReturnsPagedTenantsWithAssets()
    {
        var repo = new FakeAssetRepository();
        var handler = new GetPagedAssetStatusByTenantQueryHandler(repo);

        var result = await handler.Handle(new GetPagedAssetStatusByTenantQuery(1, 2), CancellationToken.None);

        Assert.Equal(2, result.Items.Count);
        Assert.Equal(3, result.TotalCount);
        Assert.All(result.Items, g => Assert.NotNull(g.Tenant));
    }
}

public class UpdateAssetStatusCommandHandlerTests
{
    [Fact]
    public async Task Handle_UpdatesStatus()
    {
        var repo = new FakeAssetRepository();
        var all = await repo.GetAssetStatusByTenantAsync();
        var assetId = all.Values.SelectMany(x => x).First().AssetId;

        var mediator = BuildMediator();
        var updated = await mediator.Send(new AssetManagement.Core.Commands.UpdateAssetStatusCommand(
            new UpdateAssetStatusRequest
            {
                AssetId = assetId,
                NewStatus = AssetStatus.Maintenance,
                UpdatedBy = "test-user"
            }));

        Assert.Equal(AssetStatus.Maintenance, updated.Status);
        Assert.Equal("test-user", updated.UpdatedBy);
    }

    private static IMediator BuildMediator()
    {
        var services = new ServiceCollection();
        services.AddMediatR(cfg => cfg.RegisterServicesFromAssembly(typeof(GetAssetStatusByTenantQueryHandler).Assembly));
        services.AddSingleton<AssetManagement.Core.Interfaces.IAssetRepository, FakeAssetRepository>();
        return services.BuildServiceProvider().GetRequiredService<IMediator>();
    }
}
